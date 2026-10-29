"""Standalone tests runnable without the full backend pytest dependencies."""

import unittest
from types import SimpleNamespace

from runtime.robot_group_layout import RobotGroupLayout, RobotMember


class RobotGroupLayoutTests(unittest.TestCase):
    def setUp(self) -> None:
        self.layout = RobotGroupLayout(
            [RobotMember("left", ("shoulder", "gripper")), RobotMember("right", ("shoulder", "gripper"))]
        )

    def test_joint_mapping_is_deterministic(self) -> None:
        self.assertEqual(self.layout.join({"right": (3, 4), "left": (1, 2)}), (1.0, 2.0, 3.0, 4.0))
        self.assertEqual(self.layout.split((1, 2, 3, 4)), {"left": (1., 2.), "right": (3., 4.)})

    def test_invalid_action_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            self.layout.split((1, 2, 3))
        with self.assertRaises(ValueError):
            self.layout.split((1, 2, float("nan"), 4))

    def test_missing_robot_fails_entire_sample(self) -> None:
        with self.assertRaises(ValueError):
            self.layout.join({"left": (1, 2)})


if __name__ == "__main__":
    unittest.main()
