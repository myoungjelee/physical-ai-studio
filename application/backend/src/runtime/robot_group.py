"""Hardware-independent coordination of registered robot pairs.

The caller owns the device lifecycle. This class intentionally doesn't spawn
per-robot sessions: it joins observations and routes a single action vector,
so a future runtime adapter can reuse the existing recording/policy pipeline.
"""

from collections.abc import Mapping, Sequence
from typing import Protocol

from runtime.robot_group_layout import RobotGroupLayout, RobotMember


class JointDevice(Protocol):
    @property
    def joint_names(self) -> list[str]: ...

    def get_observation(self) -> object: ...

    def send_action(self, action: object, *, goal_time: float = 0.1) -> None: ...


class RobotGroup:
    """One deterministic joint layout over multiple independent followers."""

    def __init__(self, followers: Mapping[str, JointDevice]) -> None:
        if not followers:
            raise ValueError("At least one follower is required")
        self._followers = dict(followers)
        self.layout = RobotGroupLayout(
            [RobotMember(key, tuple(robot.joint_names)) for key, robot in self._followers.items()]
        )

    def read_positions(self) -> tuple[float, ...]:
        """Collect all positions. A failed read aborts the complete sample."""
        readings: dict[str, Sequence[float]] = {}
        for key, robot in self._followers.items():
            observation = robot.get_observation()
            positions = getattr(observation, "joint_positions")
            readings[key] = positions
        return self.layout.join(readings)

    def dispatch(self, action: Sequence[float], *, goal_time: float = 0.1) -> None:
        """Validate the full action before sending any part to hardware.

        This is not an atomic actuator transaction. If a device fails mid-send,
        callers must stop the group; earlier devices may already have moved.
        """
        import numpy as np

        parts = self.layout.split(action)
        for key, robot in self._followers.items():
            robot.send_action(np.asarray(parts[key], dtype=np.float32), goal_time=goal_time)
