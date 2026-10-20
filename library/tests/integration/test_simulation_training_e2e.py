# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Opt-in training regression, qualified export/evaluation, and conveyor controls.

SIM_E2E_MODE selects train (20 steps), evaluate (qualified checkpoint), or full
(three epochs then evaluation). Long training uses train with TRAIN_STEPS=-1.
The simulator must be started separately for evaluate/full and controls.
"""

from __future__ import annotations

import json
import math
import os
import shutil
import signal
import subprocess
import threading
import time
from contextlib import contextmanager, nullcontext
from pathlib import Path
from typing import Iterator

import pytest
from lightning.pytorch.callbacks import ModelCheckpoint
from physicalai.capture import IPCamera
from physicalai.robot import SharedRobot
from physicalai.runtime import PolicySource, RobotRuntime, SyncExecution

from physicalai.data import LeRobotDataModule
from physicalai.inference import InferenceModel
from physicalai.policies import get_physicalai_policy_class, get_policy
from physicalai.train import Trainer
from tests.integration.simulation_e2e import (
    POLICIES,
    SEEDS,
    EpisodeMonitor,
    attest_runtime,
    checkpoint_entry,
    command,
    dataset_entry,
    health,
    prepare_episode,
    score,
    verify_checkpoint,
    wait_health,
)

pytestmark = [pytest.mark.integration, pytest.mark.slow]
FIRST_PARTY_POLICIES = POLICIES
SCENES = ("conveyor_sort",)


def _policy_options(name: str) -> dict:
    # Full fine-tuning of these models exceeds one 40 GB A100 at batch size 2.
    options: dict[str, dict] = {
        "molmoact2": {"lora_enabled": True, "gradient_checkpointing": True},
        "xr0": {"freeze_vision_encoder": True, "scheduler_decay_steps": None},
    }
    return options.get(name, {})


def _train(name: str, dataset: Path, output: Path, mode: str) -> tuple[object, dict]:
    data = LeRobotDataModule(repo_id=dataset_entry()["repo_id"], root=dataset, train_batch_size=2, num_workers=0)
    policy = get_policy(name, source="physicalai", **_policy_options(name))
    trainer = Trainer(
        default_root_dir=output,
        max_epochs=3,
        max_steps=int(os.environ.get("SIM_E2E_TRAIN_STEPS", "20" if mode == "train" else "-1")),
        accelerator=os.environ.get("SIM_E2E_ACCELERATOR", "auto"),
        devices=1,
        logger=False,
        callbacks=[ModelCheckpoint(dirpath=output / "checkpoints", every_n_train_steps=1000,
                                   save_top_k=0, save_last=True)],
        enable_checkpointing=True,
        enable_progress_bar=False,
    )
    start = time.monotonic()
    trainer.fit(policy, datamodule=data, ckpt_path=os.environ.get("SIM_E2E_RESUME_CHECKPOINT"), weights_only=True)
    checkpoint = output / "checkpoints/last.ckpt"
    trainer.save_checkpoint(checkpoint)
    assert trainer.global_step > 0
    assert checkpoint.is_file()
    # Only load the checkpoint generated locally by this training job, with restricted unpickling.
    restored = get_physicalai_policy_class(name).load_from_checkpoint(checkpoint, map_location="cpu", weights_only=True)
    del restored
    loss = next((trainer.callback_metrics[k] for k in ("train/loss", "train/loss_step", "train/loss_epoch")
                 if k in trainer.callback_metrics), None)
    assert loss is not None and math.isfinite(float(loss)), "Training did not produce a finite loss"
    return policy, {"training_steps": trainer.global_step, "training_seconds": time.monotonic() - start,
                    "train_loss": float(loss) if loss is not None else None, "checkpoint_reload": "passed"}


@contextmanager
def _record_video(
    output_dir: Path, url: str, cameras: list[str], camera_map: dict[str, str], fps: int, policy: str, scene: str
) -> Iterator[Path]:
    """Stream simulator cameras to MP4 without buffering frames in memory."""
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("SIM_E2E_RECORD_VIDEO requires ffmpeg on PATH")
    path = output_dir / f"inference-{policy}-{scene}.mp4"
    args = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "warning", "-y"]
    for camera in cameras:
        args += ["-thread_queue_size", "512", "-use_wallclock_as_timestamps", "1", "-i",
                 f"{url.rstrip('/')}/cameras/{camera_map.get(camera, camera)}/mjpeg"]
    if len(cameras) == 1:
        args += ["-vf", f"fps={fps},setsar=1"]
    else:
        streams = ";".join(f"[{i}:v]fps={fps},setsar=1[v{i}]" for i in range(len(cameras)))
        stack = "".join(f"[v{i}]" for i in range(len(cameras)))
        args += ["-filter_complex", f"{streams};{stack}hstack=inputs={len(cameras)}[v]", "-map", "[v]"]
    args += ["-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
             "-movflags", "+faststart", str(path)]
    log_path = output_dir / "inference-video-ffmpeg.log"
    with log_path.open("w") as log:
        process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
        try:
            time.sleep(1)
            if process.poll() is not None:
                raise RuntimeError(f"ffmpeg failed to start; see {log_path}")
            yield path
        finally:
            if process.poll() is None:
                process.send_signal(signal.SIGINT)
                try:
                    process.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                    raise RuntimeError(f"ffmpeg did not finish recording; see {log_path}") from None
            if not path.is_file() or path.stat().st_size == 0:
                raise RuntimeError(f"ffmpeg did not save an inference video; see {log_path}")


def _trials(export: Path, metadata: dict, output: Path, name: str) -> list[dict]:
    url = os.environ["SIM_E2E_HTTP_URL"]
    owner = os.environ["SIM_E2E_OWNER"]
    cameras = sorted(k.removeprefix("observation.images.") for k in metadata["features"]
                     if k.startswith("observation.images."))
    assert cameras
    camera_map = json.loads(os.environ.get("SIM_E2E_CAMERA_MAP", "{}"))
    model = InferenceModel(export, backend="openvino", device="CPU")
    recorder = (_record_video(output, url, cameras, camera_map, int(metadata["fps"]), name, "conveyor_sort")
                if os.environ.get("SIM_E2E_RECORD_VIDEO", "false").lower() == "true" else nullcontext(None))
    trials = []
    with recorder:
        for seed in SEEDS:
            before = prepare_episode(url, seed, "off", 0.04)
            stop = threading.Event()
            monitor = EpisodeMonitor(url, before, stop, float(os.environ.get("SIM_E2E_ROLLOUT_SECONDS", "180")))
            runtime = RobotRuntime(
                robot=SharedRobot.attach(name=owner),
                action_source=PolicySource(model=model, execution=SyncExecution(request_threshold=0.5)),
                cameras={key: IPCamera(url=f"{url.rstrip('/')}/cameras/{camera_map.get(key, key)}/mjpeg")
                         for key in cameras},
                fps=float(metadata["fps"]), callbacks=[monitor],
            )
            try:
                with runtime:
                    # Runtime connects its policy source on run(), not __enter__().
                    monitor.recording = False
                    runtime.run(stop_event=stop)
                    stop.clear()
                    before = prepare_episode(url, seed, "off", 0.04)
                    monitor.begin(before)
                    command(url, "episode/auto-reset", {"enabled": True})
                    wait_health(url, lambda h: h["episode"]["active"])
                    runtime.run(stop_event=stop)
                monitor.close()
                assert monitor.actions_sent > 0 and monitor.max_joint_change > 0.5
                trials.append(monitor.result(seed))
                (output / "rollouts.json").write_text(json.dumps(trials))
            finally:
                monitor.finished.set()
                if monitor.thread.ident is not None:
                    monitor.thread.join(timeout=6)
                runtime.disconnect()
                command(url, "episode/auto-reset", {"enabled": False})
    return trials


@pytest.mark.parametrize("scene", SCENES)
def test_train_export_and_run_in_simulation(scene: str, tmp_path: Path) -> None:
    """Run independent training regression or qualified checkpoint evaluation."""
    name = os.environ.get("SIM_E2E_POLICY", "act")
    mode = os.environ.get("SIM_E2E_MODE", "full")
    if name not in POLICIES or mode not in {"train", "evaluate", "full"}:
        raise ValueError("Unknown E2E policy or mode")
    output = Path(os.environ.get("SIM_E2E_OUTPUT_DIR", str(tmp_path)))
    output.mkdir(parents=True, exist_ok=True)
    recording_entry = dataset_entry()
    provenance = {"policy": name, "scene": scene, "mode": mode, "source_sha": os.environ.get("GITHUB_SHA"),
                  "dataset_repo_id": recording_entry["repo_id"], "dataset_revision": recording_entry["revision"],
                  "runtime_commits": attest_runtime()}
    entry = None
    if mode == "evaluate":
        manifest = Path(os.environ.get("SIM_E2E_CHECKPOINT_MANIFEST", "configs/simulation-e2e/checkpoints.json"))
        entry = checkpoint_entry(manifest, name)
        if entry is None:
            (output / "result.json").write_text(json.dumps({**provenance, "status": "quality_baseline_unavailable"}))
            pytest.skip(f"No qualified checkpoint for {name}; quality baseline unavailable")
            return
        from huggingface_hub import hf_hub_download

        checkpoint = Path(hf_hub_download(entry["repo_id"], entry["filename"], revision=entry["revision"]))
        verify_checkpoint(checkpoint, entry["sha256"])
        provenance["checkpoint"] = entry
        # The repo-reviewed manifest pins both the trusted training artifact and its checksum.
        policy = get_physicalai_policy_class(name).load_from_checkpoint(checkpoint, map_location="cpu", weights_only=True)
    else:
        dataset = Path(os.environ["SIM_E2E_DATASET_DIR"])
        recording = json.loads((dataset / "simulation.json").read_text())
        assert recording["scene"] == scene and recording["belt_speed"] == 0.04
        metadata = json.loads((dataset / "meta/info.json").read_text())
        if metadata["total_episodes"] != recording_entry["episodes"]:
            raise ValueError("Recording episode count does not match selected dataset")
        policy, training = _train(name, dataset, output, mode)
        provenance.update(training)
        (output / "training.json").write_text(json.dumps({**provenance, "status": "passed"}))
        if mode == "train":
            return

    dataset = Path(os.environ["SIM_E2E_DATASET_DIR"])
    metadata = json.loads((dataset / "meta/info.json").read_text())
    if metadata["total_episodes"] != recording_entry["episodes"]:
        raise ValueError("Recording episode count does not match selected dataset")
    assert metadata["features"]["action"]["shape"] == [6]
    assert metadata["features"]["observation.state"]["shape"] == [6]
    export = output / "export"
    policy.eval().cpu().export(export, backend="openvino")
    assert (export / "manifest.json").is_file()
    del policy
    trials = _trials(export, metadata, output, name)
    mean_score = score([episode for trial in trials for episode in trial["episodes"]])
    timing_ok = all(
        t["control_hz"] is not None and t["control_hz"] >= metadata["fps"] * 0.8
        and 0.9 <= (t["simulator_timing"].get("real_time_factor") or 0) <= 1.1
        and bool(t["simulator_timing"].get("camera_fps"))
        and all((rate or 0) >= metadata["fps"] * 0.8 for rate in t["simulator_timing"]["camera_fps"].values())
        for t in trials
    )
    quality_ok = entry is not None and mean_score >= entry["min_score"]
    result = {**provenance, "status": "passed" if quality_ok and timing_ok else "failed",
              "wiring": "passed", "quality": "passed" if quality_ok else ("failed" if entry else "unqualified"),
              "timing": "passed" if timing_ok else "failed", "score": mean_score, "rollouts": trials}
    (output / "result.json").write_text(json.dumps(result))
    assert timing_ok, "Control/camera rates or simulator real-time factor violate the timing contract"
    if entry is not None:
        assert quality_ok, "Sorting score is below the qualified checkpoint threshold"


def test_simulator_controls(tmp_path: Path) -> None:
    """The scripted expert must beat a no-action baseline on identical seeded episodes."""
    commits = attest_runtime()
    url = os.environ["SIM_E2E_HTTP_URL"]
    output = Path(os.environ.get("SIM_E2E_OUTPUT_DIR", str(tmp_path)))
    output.mkdir(parents=True, exist_ok=True)
    results: dict[str, dict] = {}
    try:
        for mode in ("off", "drive"):
            trials = []
            for seed in SEEDS:
                before = prepare_episode(url, seed, mode, 0.04)
                stop = threading.Event()
                monitor = EpisodeMonitor(url, before, stop, 180)
                command(url, "episode/auto-reset", {"enabled": True})
                wait_health(url, lambda h: h["episode"]["active"])
                monitor.thread.start()
                stop.wait(190)
                monitor.close()
                trials.append(monitor.result(seed))
            results[mode] = {"score": score([e for t in trials for e in t["episodes"]]), "trials": trials}
            (output / "controls.json").write_text(json.dumps({**results, "status": "incomplete",
                "runtime_commits": commits, "source_sha": os.environ.get("GITHUB_SHA")}))
        passed = results["drive"]["score"] > results["off"]["score"]
        (output / "controls.json").write_text(json.dumps({**results, "status": "passed" if passed else "failed",
            "runtime_commits": commits, "source_sha": os.environ.get("GITHUB_SHA")}))
        assert passed, "Scripted expert does not beat no-action baseline"
    finally:
        command(url, "autopilot", {"mode": "off"})
        command(url, "episode/auto-reset", {"enabled": False})
