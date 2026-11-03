"""Studio-only inference cadence control without patching installed physicalai."""

from physicalai.runtime import SyncExecution


class AdjustableSyncExecution(SyncExecution):
    """Preserve upstream defaults unless a fixed interval is requested."""

    def __init__(self, *, request_threshold: float = 0.0) -> None:
        super().__init__(request_threshold=request_threshold)
        self._replan_interval: int | None = None

    def warmup(self, sample_observation: dict) -> None:
        super().warmup(sample_observation)
        self._apply_interval()

    def set_replan_interval(self, interval: int) -> None:
        if interval < 1 or (self._chunk_size and interval > self._chunk_size):
            raise ValueError(f"Replan interval must be between 1 and model chunk size ({self._chunk_size})")
        self._replan_interval = interval
        if self._chunk_size:
            self._apply_interval()

    def _apply_interval(self) -> None:
        if self._replan_interval is not None:
            # maybe_request checks remaining queue length before the next pop.
            self._threshold_count = self._chunk_size - self._replan_interval + 1
