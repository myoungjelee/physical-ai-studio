"""Materialize compact videos for a canonical LeRobot v3 dataset."""

from __future__ import annotations

import os
import shutil
import time
from pathlib import Path
from uuid import uuid4

import pandas as pd
from lerobot.datasets.dataset_tools import _keep_episodes_from_video_with_av, encoder_config_from_video_info
from lerobot.datasets.lerobot_dataset import LeRobotDataset


def optimize_dataset(root: Path) -> Path:
    """Re-encode referenced video windows and retain the prior directory as a backup."""
    root = Path(root).resolve()
    if not (root / "meta" / "info.json").is_file():
        raise ValueError(f"Not a LeRobot dataset: {root}")
    staging = root.with_name(f"{root.name}.optimize-{uuid4().hex}")
    backup = root.with_name(f"{root.name}.pre-optimize-{time.strftime('%Y%m%d-%H%M%S')}")
    shutil.copytree(root, staging)
    try:
        _compact_videos(staging)
        LeRobotDataset(repo_id=str(uuid4()), root=staging)
        os.replace(root, backup)
        try:
            os.replace(staging, root)
        except Exception:
            os.replace(backup, root)
            raise
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    return backup


def _compact_videos(root: Path) -> None:
    dataset = LeRobotDataset(repo_id=str(uuid4()), root=root)
    metadata = pd.concat(
        [pd.read_parquet(path) for path in sorted((root / "meta" / "episodes").glob("chunk-*/file-*.parquet"))],
        ignore_index=True,
    )
    if metadata.empty or not dataset.meta.video_keys:
        return
    referenced: set[Path] = set()
    for video_key in dataset.meta.video_keys:
        groups: dict[Path, list[int]] = {}
        for row_index, row in metadata.iterrows():
            source = root / dataset.meta.video_path.format(  # type: ignore[union-attr]
                video_key=video_key,
                chunk_index=int(row[f"videos/{video_key}/chunk_index"]),
                file_index=int(row[f"videos/{video_key}/file_index"]),
            )
            groups.setdefault(source, []).append(row_index)
        encoder = encoder_config_from_video_info(dataset.meta.info.features[video_key].get("info"))
        for source, row_indices in groups.items():
            referenced.add(source)
            timestamp_key = f"videos/{video_key}/from_timestamp"
            ordered = sorted(row_indices, key=lambda index: float(metadata.at[index, timestamp_key]))
            ranges = [
                (
                    round(float(metadata.at[index, f"videos/{video_key}/from_timestamp"]) * dataset.meta.fps),
                    round(float(metadata.at[index, f"videos/{video_key}/to_timestamp"]) * dataset.meta.fps),
                )
                for index in ordered
            ]
            temporary = source.with_suffix(".optimize.tmp.mp4")
            _keep_episodes_from_video_with_av(source, temporary, ranges, dataset.meta.fps, encoder)
            os.replace(temporary, source)
            timestamp = 0.0
            for row_index in ordered:
                duration = int(metadata.at[row_index, "length"]) / dataset.meta.fps
                metadata.at[row_index, f"videos/{video_key}/from_timestamp"] = timestamp
                metadata.at[row_index, f"videos/{video_key}/to_timestamp"] = timestamp + duration
                timestamp += duration
    for video in (root / "videos").rglob("*.mp4"):
        if video not in referenced:
            video.unlink()
    _write_episode_metadata(root, metadata)


def _write_episode_metadata(root: Path, metadata: pd.DataFrame) -> None:
    existing = set((root / "meta" / "episodes").glob("chunk-*/file-*.parquet"))
    for (chunk, file_index), group in metadata.groupby(["meta/episodes/chunk_index", "meta/episodes/file_index"]):
        path = root / f"meta/episodes/chunk-{int(chunk):03d}/file-{int(file_index):03d}.parquet"
        temporary = path.with_name(f"{path.name}.tmp")
        group.reset_index(drop=True).to_parquet(temporary, index=False)
        os.replace(temporary, path)
        existing.discard(path)
    for stale in existing:
        stale.unlink()
