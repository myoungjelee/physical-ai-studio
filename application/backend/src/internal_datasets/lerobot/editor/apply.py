"""Apply canonical LeRobot v3 episode edits without touching videos.

LeRobot stores episode frame rows in shared parquet files and represents video
episodes as timestamp windows into shared MP4 files.  This module updates the
former and the normal LeRobot metadata, leaving the latter byte-identical.
"""

from __future__ import annotations

import json
import os
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from lerobot.datasets.compute_stats import aggregate_stats, get_feature_stats
from lerobot.datasets.io_utils import write_stats

_MIN_EPISODE_FRAMES = 2


@dataclass(frozen=True)
class EpisodeEdit:
    """The retained source-frame interval for one physical episode."""

    episode_index: int
    start_frame: int | None = None
    end_frame: int | None = None
    deleted: bool = False


@dataclass(frozen=True)
class _PlannedEpisode:
    old_index: int
    new_index: int
    start_frame: int
    end_frame: int
    length: int
    from_index: int
    to_index: int
    metadata: dict[str, Any]


def apply_episode_edits(dataset_root: Path, edits: list[EpisodeEdit], *, operation: str) -> Path:
    """Apply *edits* and return the created data/meta backup directory.

    The operation is intentionally synchronous: it only rewrites parquet and
    metadata and must complete before callers expose the new canonical state.
    Every changed file is replaced by rename after a hard-link backup is made.
    """
    if not edits:
        raise ValueError("At least one episode edit is required")

    root = Path(dataset_root)
    info_path = root / "meta" / "info.json"
    if not info_path.is_file():
        raise ValueError(f"Not a LeRobot dataset: {root}")

    info = json.loads(info_path.read_text(encoding="utf-8"))
    fps = int(info["fps"])
    features: dict[str, dict[str, Any]] = info["features"]
    episodes, episode_files = _load_episodes(root)
    edit_by_index = {edit.episode_index: edit for edit in edits}
    if len(edit_by_index) != len(edits):
        raise ValueError("An episode may only appear once in an edit request")

    known_indices = set(episodes["episode_index"].astype(int).tolist())
    unknown = sorted(set(edit_by_index) - known_indices)
    if unknown:
        raise ValueError(f"Unknown episode indices: {unknown}")

    plan = _build_plan(episodes, edit_by_index)
    backup = _create_backup(root, operation=operation, episode_indices=sorted(edit_by_index))
    try:
        _rewrite_dataset(root, info, features, episodes, episode_files, plan, fps)
    except Exception:
        # The backup is intentionally retained for recovery. Individual file
        # writes are atomic, so no file is ever observed partially written.
        raise
    return backup


def _load_episodes(root: Path) -> tuple[pd.DataFrame, list[Path]]:
    episode_files = sorted((root / "meta" / "episodes").glob("chunk-*/file-*.parquet"))
    if not episode_files:
        raise ValueError("LeRobot dataset has no episode metadata parquet files")
    episodes = pd.concat([pd.read_parquet(path) for path in episode_files], ignore_index=True)
    if episodes.empty:
        raise ValueError("LeRobot dataset has no episodes")
    required = {
        "episode_index",
        "length",
        "dataset_from_index",
        "dataset_to_index",
        "data/chunk_index",
        "data/file_index",
    }
    missing = sorted(required - set(episodes.columns))
    if missing:
        raise ValueError(f"Episode metadata is missing required columns: {missing}")
    return episodes.sort_values("episode_index").reset_index(drop=True), episode_files


def _build_plan(episodes: pd.DataFrame, edits: dict[int, EpisodeEdit]) -> list[_PlannedEpisode]:
    retained: list[tuple[dict[str, Any], int, int]] = []
    for row in episodes.to_dict(orient="records"):
        old_index = int(row["episode_index"])
        original_length = int(row["length"])
        edit = edits.get(old_index)
        if edit is not None and edit.deleted:
            continue
        start = 0 if edit is None or edit.start_frame is None else edit.start_frame
        end = original_length if edit is None or edit.end_frame is None else edit.end_frame
        if start < 0 or end > original_length or start >= end:
            raise ValueError(
                f"Episode {old_index} trim [{start}, {end}) is outside its {original_length}-frame range"
            )
        if end - start < _MIN_EPISODE_FRAMES:
            raise ValueError(f"Episode {old_index} must retain at least {_MIN_EPISODE_FRAMES} frames")
        retained.append((row, start, end))

    if not retained:
        raise ValueError("A LeRobot dataset must retain at least one episode")

    plan: list[_PlannedEpisode] = []
    cursor = 0
    for new_index, (row, start, end) in enumerate(retained):
        length = end - start
        plan.append(
            _PlannedEpisode(
                old_index=int(row["episode_index"]),
                new_index=new_index,
                start_frame=start,
                end_frame=end,
                length=length,
                from_index=cursor,
                to_index=cursor + length,
                metadata=row,
            )
        )
        cursor += length
    return plan


def _rewrite_dataset(  # noqa: C901, PLR0912, PLR0915
    root: Path,
    info: dict[str, Any],
    features: dict[str, dict[str, Any]],
    episodes: pd.DataFrame,
    episode_files: list[Path],
    plan: list[_PlannedEpisode],
    fps: int,
) -> None:
    tasks = pd.read_parquet(root / "meta" / "tasks.parquet")
    task_by_index = {int(index): str(task) for task, index in tasks["task_index"].items()}
    data_groups: dict[Path, list[_PlannedEpisode]] = {}
    for item in plan:
        row = item.metadata
        data_path = root / info["data_path"].format(
            chunk_index=int(row["data/chunk_index"]), file_index=int(row["data/file_index"])
        )
        data_groups.setdefault(data_path, []).append(item)

    used_task_names: list[str] = []
    rewritten_frames: dict[int, pd.DataFrame] = {}
    for data_path, items in data_groups.items():
        source = pd.read_parquet(data_path)
        pieces: list[pd.DataFrame] = []
        for item in sorted(items, key=lambda candidate: candidate.new_index):
            piece = source[source["episode_index"] == item.old_index].sort_values("frame_index")
            piece = piece.iloc[item.start_frame : item.end_frame].copy()
            if len(piece) != item.length:
                raise ValueError(
                    f"Episode {item.old_index} metadata selected {item.length} frames but its parquet contains "
                    f"{len(piece)}"
                )
            piece["frame_index"] = np.arange(item.length, dtype=np.int64)
            piece["timestamp"] = (np.arange(item.length) / fps).astype(np.float32)
            piece["index"] = np.arange(item.from_index, item.to_index, dtype=np.int64)
            piece["episode_index"] = np.int64(item.new_index)
            if "task_index" in piece:
                source_task_indices = piece["task_index"].astype(int).tolist()
                for task_index in source_task_indices:
                    task = task_by_index.get(task_index)
                    if task is None:
                        raise ValueError(f"Episode {item.old_index} refers to unknown task index {task_index}")
                    if task not in used_task_names:
                        used_task_names.append(task)
            pieces.append(piece)
            rewritten_frames[item.old_index] = piece
        _write_parquet(pd.concat(pieces, ignore_index=True), data_path)

    all_data_paths = {
        root
        / info["data_path"].format(
            chunk_index=int(row["data/chunk_index"]), file_index=int(row["data/file_index"])
        )
        for row in episodes.to_dict(orient="records")
    }
    for stale in all_data_paths - set(data_groups):
        stale.unlink(missing_ok=True)

    task_index_by_name = {task: index for index, task in enumerate(used_task_names)}
    for frame in rewritten_frames.values():
        if "task_index" in frame:
            frame["task_index"] = frame["task_index"].map(
                lambda value: task_index_by_name[task_by_index[int(value)]]
            ).astype(np.int64)

    # The task-index remapping is the only post-write data modification. Replace
    # each file once more with the final task mapping rather than modifying it in
    # place, preserving the backup's hard-link contents.
    for data_path, items in data_groups.items():
        remapped = [rewritten_frames[item.old_index] for item in sorted(items, key=lambda x: x.new_index)]
        _write_parquet(pd.concat(remapped, ignore_index=True), data_path)

    meta_rows: list[dict[str, Any]] = []
    episode_stats: list[dict[str, dict[str, np.ndarray]]] = []
    for item in plan:
        row = dict(item.metadata)
        row["episode_index"] = item.new_index
        row["length"] = item.length
        row["dataset_from_index"] = item.from_index
        row["dataset_to_index"] = item.to_index
        for feature_name, feature in features.items():
            if feature.get("dtype") not in {"video"}:
                continue
            from_key = f"videos/{feature_name}/from_timestamp"
            to_key = f"videos/{feature_name}/to_timestamp"
            if from_key in row:
                source_from = float(row[from_key])
                row[from_key] = source_from + item.start_frame / fps
                row[to_key] = source_from + item.end_frame / fps

        frame = rewritten_frames[item.old_index]
        task_names = []
        if "task_index" in frame:
            for task_id in frame["task_index"].astype(int).tolist():
                task = used_task_names[task_id]
                if task not in task_names:
                    task_names.append(task)
        row["tasks"] = np.array(task_names, dtype=object)
        stats = _numeric_stats(frame, features)
        for feature_name, feature_stats in stats.items():
            for stat_name, value in feature_stats.items():
                row[f"stats/{feature_name}/{stat_name}"] = value.tolist()
        episode_stats.append(stats)
        meta_rows.append(row)

    metadata = pd.DataFrame(meta_rows)
    existing_meta = set(episode_files)
    for (chunk, file_index), group in metadata.groupby(["meta/episodes/chunk_index", "meta/episodes/file_index"]):
        path = root / f"meta/episodes/chunk-{int(chunk):03d}/file-{int(file_index):03d}.parquet"
        _write_parquet(group.reset_index(drop=True), path)
        existing_meta.discard(path)
    for stale in existing_meta:
        stale.unlink(missing_ok=True)

    task_table = pd.DataFrame({"task_index": range(len(used_task_names))}, index=pd.Index(used_task_names, name="task"))
    _write_parquet(task_table, root / "meta" / "tasks.parquet")

    info["total_episodes"] = len(plan)
    info["total_frames"] = sum(item.length for item in plan)
    info["total_tasks"] = len(used_task_names)
    info["splits"] = {"train": f"0:{len(plan)}"}
    _write_json(info, root / "meta" / "info.json")
    if episode_stats:
        write_stats(aggregate_stats(episode_stats), root)


def _numeric_stats(frame: pd.DataFrame, features: dict[str, dict[str, Any]]) -> dict[str, dict[str, np.ndarray]]:
    stats: dict[str, dict[str, np.ndarray]] = {}
    for name, feature in features.items():
        if name not in frame or feature.get("dtype") in {"image", "video", "string", "language"}:
            continue
        values = frame[name].to_numpy()
        array = np.asarray(values) if feature.get("shape") in ([], [1], (1,)) else np.stack(values)
        stats[name] = get_feature_stats(array, axis=0, keepdims=array.ndim == 1)
    return stats


def _create_backup(root: Path, *, operation: str, episode_indices: list[int]) -> Path:
    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup = root / "_backups" / stamp
    suffix = 0
    while backup.exists():
        suffix += 1
        backup = root / "_backups" / f"{stamp}-{suffix}"
    backup.mkdir(parents=True)
    for name in ("data", "meta"):
        source = root / name
        if source.is_dir():
            _hardlink_tree(source, backup / name)
    _write_json(
        {
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "operation": operation,
            "episode_indices": episode_indices,
        },
        backup / "manifest.json",
    )
    return backup


def _hardlink_tree(source: Path, destination: Path) -> None:
    for path in source.rglob("*"):
        if path.is_dir():
            continue
        target = destination / path.relative_to(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.link(path, target)
        except OSError:
            shutil.copy2(path, target)


def _write_parquet(data: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.tmp")
    data.to_parquet(temporary, index=False)
    os.replace(temporary, path)


def _write_json(payload: dict[str, Any], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.tmp")
    temporary.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    os.replace(temporary, path)
