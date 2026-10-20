# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Offline tests for the weekly simulation protocol; no hardware or downloads."""

import hashlib
import json
import os
import subprocess
import threading
import tomllib
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import numpy as np
import pytest
import yaml

from scripts.simulation_report import summarize
from tests.integration import simulation_e2e as controls
from tests.integration import test_simulation_training_e2e as suite


def snapshot(count=0, correct=7):
    return {"episode": {"episode_count": count, "items_per_episode": 10,
                        "last_episode": {"correct": correct, "wrong": 1, "missed": 9 - correct}},
            "timing": {"real_time_factor": 1.0}}


def test_monitor_collects_one_complete_episode_and_stops():
    stop = threading.Event()
    monitor = controls.EpisodeMonitor("http://localhost", snapshot(), stop, 1)
    monitor.observe(snapshot(1))
    assert stop.is_set()
    assert monitor.result(42)["score"] == 0.7
    assert monitor.result(42)["seed"] == 42


@pytest.mark.parametrize("count", [-1, 2])
def test_monitor_rejects_lost_or_reset_episodes(count):
    monitor = controls.EpisodeMonitor("http://localhost", snapshot(), threading.Event(), 1)
    with pytest.raises(AssertionError, match="Lost simulator"):
        monitor.observe(snapshot(count))


def test_monitor_rejects_partial_item_accounting():
    monitor = controls.EpisodeMonitor("http://localhost", snapshot(), threading.Event(), 1)
    value = snapshot(1)
    value["episode"]["last_episode"]["missed"] = 0
    with pytest.raises(AssertionError, match="Incomplete"):
        monitor.observe(value)


def test_tick_metrics_do_not_poll_http(monkeypatch):
    monkeypatch.setattr(controls, "health", MagicMock(side_effect=AssertionError("HTTP in tick")))
    monitor = controls.EpisodeMonitor("http://localhost", snapshot(), threading.Event(), 1)
    for position in (0, 2):
        monitor.on_tick(SimpleNamespace(action_sent=np.ones(6),
                        robot_state=SimpleNamespace(joint_positions=np.full(6, position)),
                        camera_frames={"wrist": SimpleNamespace(timestamp=float(position))}))
    monitor.on_inference(SimpleNamespace(latency_s=0.02))
    monitor.observe(snapshot(1))
    result = monitor.result(42)
    assert result["actions_sent"] == 2
    assert result["max_joint_change"] == 2
    assert result["unique_camera_frames"] == {"wrist": 2}
    assert result["inference_p95_s"] == 0.02
    controls.health.assert_not_called()


def test_monitor_deadline_stops_runtime(monkeypatch):
    monkeypatch.setattr(controls, "health", lambda url: snapshot())
    stop = threading.Event()
    monitor = controls.EpisodeMonitor("http://localhost", snapshot(), stop, 0)
    monitor.thread.start()
    assert stop.wait(1)
    with pytest.raises(TimeoutError, match="Episode did not finish"):
        monitor.close()


def test_seeded_setup_uses_mode_barrier_before_resuming(monkeypatch):
    calls = []
    monkeypatch.setattr(controls, "command", lambda url, route, payload: calls.append((route, payload)))
    states = [{"episode": {"active": False}}, {"autopilot": {"mode": "leader"}}, {"seed": 42},
              {"autopilot": {"mode": "off"}, "episode": {"spawned": 0, "belt_speed": 0.04}}]
    monkeypatch.setattr(controls, "health", lambda url: states.pop(0))
    controls.prepare_episode("http://localhost", 42, "off", 0.04)
    assert calls == [("episode/auto-reset", {"enabled": False}), ("autopilot", {"mode": "leader"}),
                     ("seed", {"seed": 42}), ("conveyor/belt-speed", {"speed": 0.04}),
                     ("reset", {}), ("autopilot", {"mode": "off"})]


def test_missing_checkpoint_is_explicitly_unqualified(tmp_path, monkeypatch):
    manifest = tmp_path / "checkpoints.json"
    manifest.write_text(json.dumps({"act": None}))
    monkeypatch.setenv("SIM_E2E_MODE", "evaluate")
    monkeypatch.setenv("SIM_E2E_POLICY", "act")
    monkeypatch.setenv("SIM_E2E_CHECKPOINT_MANIFEST", str(manifest))
    monkeypatch.setenv("SIM_E2E_OUTPUT_DIR", str(tmp_path))
    monkeypatch.setattr(suite, "attest_runtime", lambda: {})
    with pytest.raises(pytest.skip.Exception):
        suite.test_train_export_and_run_in_simulation("conveyor_sort", tmp_path)
    assert json.loads((tmp_path / "result.json").read_text())["status"] == "quality_baseline_unavailable"


@pytest.mark.parametrize("field,value", [("revision", "main"), ("filename", "../model.ckpt"),
                                        ("filename", "nested/model.ckpt"), ("sha256", "bad"),
                                        ("min_score", 0), ("min_score", True)])
def test_qualified_checkpoint_manifest_validation(tmp_path, field, value):
    entry = {"repo_id": "org/policy", "revision": "a" * 40, "filename": "model.ckpt",
             "sha256": "b" * 64, "min_score": 0.5}
    entry[field] = value
    manifest = tmp_path / "checkpoints.json"
    manifest.write_text(json.dumps({"act": entry}))
    with pytest.raises(ValueError):
        controls.checkpoint_entry(manifest, "act")


def test_checkpoint_checksum(tmp_path):
    checkpoint = tmp_path / "model.ckpt"
    checkpoint.write_bytes(b"checkpoint")
    controls.verify_checkpoint(checkpoint, hashlib.sha256(b"checkpoint").hexdigest())
    with pytest.raises(ValueError, match="checksum mismatch"):
        controls.verify_checkpoint(checkpoint, "b" * 64)


@pytest.mark.parametrize("policy", controls.POLICIES)
@pytest.mark.parametrize("mode,steps", [("train", None), ("train", "-1"), ("full", None)])
def test_training_budget_and_reload(tmp_path, monkeypatch, policy, mode, steps):
    monkeypatch.delenv("SIM_E2E_RESUME_CHECKPOINT", raising=False)
    monkeypatch.delenv("SIM_E2E_TRAIN_STEPS", raising=False)
    if steps is not None:
        monkeypatch.setenv("SIM_E2E_TRAIN_STEPS", steps)
    model = MagicMock()
    make_policy = MagicMock(return_value=model)
    monkeypatch.setattr(suite, "get_policy", make_policy)
    make_class = MagicMock()
    monkeypatch.setattr(suite, "get_physicalai_policy_class", make_class)
    monkeypatch.setattr(suite, "LeRobotDataModule", MagicMock())
    trainer = MagicMock(global_step=20, callback_metrics={"train/loss": 0.2})

    def fit(*args, **kwargs):
        path = tmp_path / "checkpoints/last.ckpt"
        path.parent.mkdir()
        path.touch()

    trainer.fit.side_effect = fit
    make_trainer = MagicMock(return_value=trainer)
    monkeypatch.setattr(suite, "Trainer", make_trainer)
    _, result = suite._train(policy, tmp_path, tmp_path, mode)
    assert make_trainer.call_args.kwargs["max_epochs"] == 3
    assert make_trainer.call_args.kwargs["max_steps"] == (int(steps) if steps else (20 if mode == "train" else -1))
    assert result["checkpoint_reload"] == "passed"
    trainer.save_checkpoint.assert_called_once_with(tmp_path / "checkpoints/last.ckpt")
    make_class.return_value.load_from_checkpoint.assert_called_once_with(
        tmp_path / "checkpoints/last.ckpt", map_location="cpu", weights_only=True)
    if policy == "molmoact2":
        make_policy.assert_called_once_with(policy, source="physicalai", lora_enabled=True, gradient_checkpointing=True)
    elif policy == "xr0":
        make_policy.assert_called_once_with(policy, source="physicalai", freeze_vision_encoder=True, scheduler_decay_steps=None)
    else:
        make_policy.assert_called_once_with(policy, source="physicalai")


@pytest.mark.parametrize("timing_ok,quality_ok", [(True, True), (False, True), (True, False)])
def test_evaluation_reports_quality_and_timing_separately(tmp_path, monkeypatch, timing_ok, quality_ok):
    entry = {"repo_id": "org/model", "revision": "a" * 40, "filename": "model.ckpt",
             "sha256": "b" * 64, "min_score": 0.5}
    (tmp_path / "meta").mkdir()
    (tmp_path / "meta/info.json").write_text(json.dumps({"fps": 30, "features": {
        "action": {"shape": [6]}, "observation.state": {"shape": [6]}}}))
    monkeypatch.setenv("SIM_E2E_MODE", "evaluate")
    monkeypatch.setenv("SIM_E2E_POLICY", "act")
    monkeypatch.setenv("SIM_E2E_DATASET_DIR", str(tmp_path))
    monkeypatch.setenv("SIM_E2E_OUTPUT_DIR", str(tmp_path))
    monkeypatch.setattr(suite, "attest_runtime", lambda: {})
    monkeypatch.setattr(suite, "checkpoint_entry", lambda *args: entry)
    monkeypatch.setattr(suite, "verify_checkpoint", MagicMock())
    import huggingface_hub

    monkeypatch.setattr(huggingface_hub, "hf_hub_download", lambda *args, **kwargs: str(tmp_path / "model.ckpt"))
    model = MagicMock()
    model.eval.return_value.cpu.return_value = model

    def export(path, backend):
        path.mkdir()
        (path / "manifest.json").write_text("{}")

    model.export.side_effect = export
    cls = MagicMock()
    cls.load_from_checkpoint.return_value = model
    monkeypatch.setattr(suite, "get_physicalai_policy_class", lambda name: cls)
    episode = {"correct": 7 if quality_ok else 0, "wrong": 0, "missed": 3 if quality_ok else 10}
    monkeypatch.setattr(suite, "_trials", lambda *args: [{"episodes": [episode], "control_hz": 30 if timing_ok else 2,
        "simulator_timing": {"real_time_factor": 1.0, "camera_fps": {"wrist": 30, "overview": 30}}}])
    if timing_ok and quality_ok:
        suite.test_train_export_and_run_in_simulation("conveyor_sort", tmp_path)
    else:
        with pytest.raises(AssertionError):
            suite.test_train_export_and_run_in_simulation("conveyor_sort", tmp_path)
    result = json.loads((tmp_path / "result.json").read_text())
    assert result["quality"] == ("passed" if quality_ok else "failed")
    assert result["timing"] == ("passed" if timing_ok else "failed")
    assert result["wiring"] == "passed"


def test_weekly_report_does_not_promote_missing_or_zero_scores(tmp_path):
    directory = tmp_path / "sim-evaluate-act"
    directory.mkdir()
    (directory / "result.json").write_text(json.dumps({"status": "failed", "quality": "failed",
                                                     "wiring": "passed", "timing": "passed", "score": 0}))
    directory = tmp_path / "sim-evaluate-xr0"
    directory.mkdir()
    (directory / "result.json").write_text(json.dumps({"status": "quality_baseline_unavailable"}))
    report = summarize(tmp_path)
    assert "| act | failed/incomplete | passed | passed | failed | 0.0% |" in report
    assert "| xr0 | failed/incomplete | not evaluated | not evaluated | baseline unavailable |" in report


def test_trial_warms_then_reseeds_before_resuming(tmp_path, monkeypatch):
    events = []
    monkeypatch.setattr(suite, "SEEDS", (42,))
    monkeypatch.setenv("SIM_E2E_HTTP_URL", "http://localhost")
    monkeypatch.setenv("SIM_E2E_OWNER", "test")
    monkeypatch.setenv("SIM_E2E_RECORD_VIDEO", "false")
    monkeypatch.setattr(suite, "prepare_episode", lambda *args: events.append("prepare") or snapshot())
    monkeypatch.setattr(suite, "command", lambda url, route, payload: events.append("resume" if payload["enabled"] else "pause"))
    monkeypatch.setattr(suite, "wait_health", MagicMock())
    monkeypatch.setattr(suite, "InferenceModel", MagicMock())
    monkeypatch.setattr(suite, "SharedRobot", MagicMock())
    monkeypatch.setattr(suite, "IPCamera", MagicMock())
    monkeypatch.setattr(suite, "PolicySource", MagicMock())
    monitor = MagicMock(actions_sent=2, max_joint_change=2)
    monitor.begin.side_effect = lambda before: events.append("begin")
    monitor.result.return_value = {"score": 0.7}
    monkeypatch.setattr(suite, "EpisodeMonitor", MagicMock(return_value=monitor))
    runtime = MagicMock()
    runtime.run.side_effect = lambda **kwargs: events.append("run")
    monkeypatch.setattr(suite, "RobotRuntime", MagicMock(return_value=runtime))
    suite._trials(tmp_path, {"fps": 30, "features": {"observation.images.wrist": {}}}, tmp_path, "act")
    assert events == ["prepare", "run", "prepare", "begin", "resume", "run", "pause"]
    runtime.disconnect.assert_called_once()


def test_paused_warmup_does_not_enter_trial_metrics():
    stop = threading.Event()
    monitor = controls.EpisodeMonitor("http://localhost", snapshot(), stop, 1)
    monitor.recording = False
    monitor.on_tick(SimpleNamespace())
    assert stop.is_set()
    assert monitor.ticks == []


def test_timing_includes_delay_before_first_action(monkeypatch):
    monitor = controls.EpisodeMonitor("http://localhost", snapshot(), threading.Event(), 1)
    monitor.started_at = 0
    monitor.ticks = [10, 10.01]
    monitor.observe(snapshot(1))
    result = monitor.result(42)
    assert result["control_hz"] < 1
    assert result["first_action_delay_s"] == 10


def test_final_checkpoint_includes_steps_after_periodic_save(tmp_path, monkeypatch):
    import torch
    from lightning.pytorch import LightningModule
    from torch.utils.data import DataLoader, TensorDataset

    class Tiny(LightningModule):
        def __init__(self):
            super().__init__()
            self.layer = torch.nn.Linear(1, 1)

        def training_step(self, batch, batch_idx):
            loss = self.layer(batch[0]).square().mean()
            self.log("train/loss", loss)
            return loss

        def configure_optimizers(self):
            return torch.optim.SGD(self.parameters(), lr=0.01)

        def train_dataloader(self):
            # This test runs exclusively on CPU, so there are no CUDA transfers to accelerate.
            # nosemgrep: trailofbits.python.automatic-memory-pinning.automatic-memory-pinning
            return DataLoader(TensorDataset(torch.ones(4, 1)), batch_size=2, pin_memory=False)

    real_trainer = suite.Trainer

    def make_trainer(**kwargs):
        kwargs["callbacks"] = [suite.ModelCheckpoint(dirpath=tmp_path / "checkpoints", every_n_train_steps=2,
                                                     save_top_k=0, save_last=True)]
        kwargs["enable_model_summary"] = False
        return real_trainer(**kwargs)

    monkeypatch.setenv("SIM_E2E_TRAIN_STEPS", "3")
    monkeypatch.setenv("SIM_E2E_ACCELERATOR", "cpu")
    monkeypatch.delenv("SIM_E2E_RESUME_CHECKPOINT", raising=False)
    monkeypatch.setattr(suite, "Trainer", make_trainer)
    monkeypatch.setattr(suite, "LeRobotDataModule", lambda **kwargs: None)
    monkeypatch.setattr(suite, "get_policy", lambda *args, **kwargs: Tiny())
    # Avoid importing a local test class from checkpoint hyperparameters; inspect the locally generated data below.
    monkeypatch.setattr(suite, "get_physicalai_policy_class", lambda name: MagicMock())
    suite._train("act", tmp_path, tmp_path, "train")
    # This test reads only the checkpoint it just generated, using the restricted weights-only unpickler.
    # nosemgrep: trailofbits.python.pickles-in-pytorch.pickles-in-pytorch
    saved = torch.load(tmp_path / "checkpoints/last.ckpt", weights_only=True)
    assert saved["global_step"] == 3


def test_video_requests_require_encoder(tmp_path, monkeypatch):
    monkeypatch.setattr(suite.shutil, "which", lambda name: None)
    with pytest.raises(RuntimeError, match="requires ffmpeg"):
        with suite._record_video(tmp_path, "http://localhost", ["overview"], {}, 30, "act", "conveyor_sort"):
            pass


@pytest.mark.parametrize("job", ["controls", "policy"])
@pytest.mark.parametrize("borrowed_pid", [False, True])
def test_cleanup_never_shuts_down_an_unowned_simulator(tmp_path, job, borrowed_pid):
    root = Path(__file__).resolve().parents[3]
    workflow = yaml.safe_load((root / ".github/workflows/simulation-library-e2e.yml").read_text())
    cleanup = next(step["run"] for step in workflow["jobs"][job]["steps"] if step.get("name") == "Stop owner")
    binary = tmp_path / "bin"
    binary.mkdir()
    curl = binary / "curl"
    curl.write_text('#!/bin/sh\\ntouch "$SIM_E2E_OUTPUT_DIR/unexpected-shutdown"\\n')
    curl.chmod(0o755)
    if borrowed_pid:
        (tmp_path / "owner.pid").write_text(str(os.getpid()))
    # Execute only the trusted repository cleanup script, with curl replaced by a local test stub.
    subprocess.run(["bash", "-c", cleanup], check=True, env={
        "PATH": f"{binary}:{os.environ['PATH']}", "SIM_E2E_OUTPUT_DIR": str(tmp_path),
        "SIM_E2E_HTTP_URL": "http://localhost", "SIM_E2E_OWNER": "not-owned-by-this-test"})
    assert not (tmp_path / "unexpected-shutdown").exists()


def test_lockfile_resolves_the_configured_runtime_pin():
    library = Path(__file__).resolve().parents[2]
    for project in (library, library.parent / "application/backend"):
        config = tomllib.loads((project / "pyproject.toml").read_text())
        expected = config["tool"]["uv"]["sources"]["physicalai"]["rev"]
        lock = tomllib.loads((project / "uv.lock").read_text())
        package = next(p for p in lock["package"] if p["name"] == "physicalai")
        assert package["source"]["git"].endswith(f"#{expected}")
        assert expected == controls.RUNTIME_REVISION


def test_runtime_attestation_rejects_mixed_pins(monkeypatch):
    dist = MagicMock()
    dist.read_text.return_value = json.dumps({"vcs_info": {"commit_id": "f" * 40}})
    monkeypatch.setattr(controls, "distribution", lambda name: dist)
    with pytest.raises(RuntimeError, match="pinned Runtime"):
        controls.attest_runtime()
