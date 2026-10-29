"""Stable joint-vector layout for a group of independently registered robots.

This module owns only index mapping. Hardware lifecycle and sampling remain the
responsibility of the runtime; keeping this pure makes it easy to test.
"""

from dataclasses import dataclass
from typing import Sequence


@dataclass(frozen=True)
class RobotMember:
    key: str
    joint_names: tuple[str, ...]


class RobotGroupLayout:
    """Validate and map robot-local joint vectors into one named vector."""

    def __init__(self, members: Sequence[RobotMember]) -> None:
        if not members:
            raise ValueError("A robot group requires at least one follower")
        if len({member.key for member in members}) != len(members):
            raise ValueError("Robot group member keys must be unique")
        if any(not member.key or "." in member.key for member in members):
            raise ValueError("Member keys must be nonempty and must not contain '.'")
        for member in members:
            if not member.joint_names or len(set(member.joint_names)) != len(member.joint_names):
                raise ValueError(f"Invalid joint names for member {member.key!r}")

        self.members = tuple(members)
        self.joint_names = tuple(
            f"{member.key}.{joint}" for member in self.members for joint in member.joint_names
        )

    def join(self, positions: dict[str, Sequence[float]]) -> tuple[float, ...]:
        if positions.keys() != {member.key for member in self.members}:
            raise ValueError("Robot group readings must contain exactly the registered members")
        values: list[float] = []
        for member in self.members:
            reading = positions[member.key]
            if len(reading) != len(member.joint_names):
                raise ValueError(f"Joint count mismatch for member {member.key!r}")
            values.extend(float(value) for value in reading)
        return tuple(values)

    def split(self, values: Sequence[float]) -> dict[str, tuple[float, ...]]:
        if len(values) != len(self.joint_names):
            raise ValueError("Action dimension does not match robot group layout")
        result: dict[str, tuple[float, ...]] = {}
        start = 0
        for member in self.members:
            end = start + len(member.joint_names)
            result[member.key] = tuple(float(value) for value in values[start:end])
            start = end
        return result
