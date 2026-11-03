"""Opt-in, low-overhead per-tick inference diagnostics persisted on the Studio storage volume."""

from __future__ import annotations

import csv
import queue
import threading
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from loguru import logger

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

    from physicalai.runtime import LifecycleEvent as RuntimeLifecycleEvent
    from physicalai.runtime import TickEvent

    from runtime.contract import FollowerSource


class InferenceDiagnostics:
    """Record observed state and the action actually sent, without blocking the control loop."""

    _MAX_QUEUED_FRAMES = 4096

    def __init__(self, root: Path) -> None:
        self._root = root
        self._id: UUID | None = None
        self._model_id: UUID | None = None
        self._queue: queue.Queue[list[object] | None] | None = None
        self._worker: threading.Thread | None = None
        self._lost_frames = 0

    @property
    def recording_id(self) -> UUID | None:
        return self._id

    @property
    def is_recording(self) -> bool:
        return self._queue is not None

    def start(self, model_id: UUID, joint_names: list[str]) -> UUID:
        if self.is_recording:
            raise ValueError("A diagnostic recording is already active")
        if not joint_names:
            raise ValueError("Joint names are not available")
        recording_id = uuid4()
        directory = self._root / str(model_id)
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{recording_id}.csv"
        partial_path = directory / f"{recording_id}.csv.partial"
        fields = ["step", "timestamp_s", "loop_duration_s", "stale_obs", "source_updated"]
        fields += [f"state.{name}" for name in joint_names]
        fields += [f"sent_action.{name}" for name in joint_names]
        channel: queue.Queue[list[object] | None] = queue.Queue(maxsize=self._MAX_QUEUED_FRAMES)

        def write() -> None:
            try:
                with partial_path.open("w", newline="", encoding="utf-8") as output:
                    writer = csv.writer(output)
                    writer.writerow(fields)
                    while (row := channel.get()) is not None:
                        writer.writerow(row)
                partial_path.replace(path)
            except Exception:
                logger.exception("Failed to write inference diagnostics: {}", path)

        thread = threading.Thread(target=write, name="inference-diagnostics-writer", daemon=True)
        thread.start()
        self._id = recording_id
        self._model_id = model_id
        self._queue = channel
        self._worker = thread
        self._lost_frames = 0
        return recording_id

    def record(self, event: TickEvent, *, policy_active: bool) -> None:
        channel = self._queue
        if channel is None or not policy_active or event.action_sent is None:
            return
        row: list[object] = [
            event.step,
            event.timestamp,
            event.loop_duration_s,
            event.stale_obs,
            event.source_updated,
            *(float(x) for x in event.robot_state.joint_positions),
            *(float(x) for x in event.action_sent),
        ]
        try:
            channel.put_nowait(row)
        except queue.Full:
            self._lost_frames += 1

    def clear_last_recording(self) -> None:
        """Hide a previous model's download link after switching models."""
        if self.is_recording:
            raise ValueError("Stop recording before changing model")
        self._id = None
        self._model_id = None

    def stop(self) -> UUID | None:
        channel, worker = self._queue, self._worker
        self._queue = None
        self._worker = None
        if channel is None:
            return self._id

        # Drain without blocking the robot control thread; writes continue in the background.
        def finish() -> None:
            channel.put(None)
            if worker is not None:
                worker.join()
            if self._lost_frames:
                logger.warning("Inference diagnostics dropped {} frames due to a full queue", self._lost_frames)

        threading.Thread(target=finish, name="inference-diagnostics-finalizer", daemon=True).start()
        return self._id


class DiagnosticsTickCallback:
    def __init__(self, diagnostics: InferenceDiagnostics, follower_source: Callable[[], FollowerSource]) -> None:
        self._diagnostics = diagnostics
        self._follower_source = follower_source

    def on_tick(self, event: TickEvent) -> None:
        self._diagnostics.record(event, policy_active=self._follower_source() == "policy")

    def on_lifecycle(self, event: RuntimeLifecycleEvent) -> None:
        if event.event == "shutdown":
            self._diagnostics.stop()
