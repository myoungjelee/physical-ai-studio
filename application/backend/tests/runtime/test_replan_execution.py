"""Verify fixed cadence doesn't change the default threshold behavior."""

import numpy as np
import pytest
from physicalai.runtime import ChunkedActionQueue

from runtime.replan_execution import AdjustableSyncExecution


class FakeModel:
    def __init__(self, chunk_size: int = 100) -> None:
        self.chunk_size = chunk_size
        self.requests = 0

    def predict_action_chunk(self, _observation: dict) -> np.ndarray:
        self.requests += 1
        return np.zeros((self.chunk_size, 6), dtype=np.float32)


def test_default_threshold_and_fixed_interval() -> None:
    for interval, expected_requests in ((None, 1), (20, 3), (50, 2), (100, 1)):
        model = FakeModel()
        queue = ChunkedActionQueue()
        execution = AdjustableSyncExecution(request_threshold=0.5)
        execution.start(model, queue)
        execution.warmup({})
        if interval is not None:
            execution.set_replan_interval(interval)
        for _ in range(51):
            execution.maybe_request({})
            assert queue.pop() is not None
        # Requests include warmup. Interval=20 triggers after 20 and 40 pops.
        assert model.requests == expected_requests


def test_replan_interval_cannot_exceed_model_chunk() -> None:
    execution = AdjustableSyncExecution()
    queue = ChunkedActionQueue()
    execution.start(FakeModel(32), queue)
    execution.warmup({})
    with pytest.raises(ValueError, match="chunk size"):
        execution.set_replan_interval(100)
