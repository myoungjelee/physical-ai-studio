import pytest

from runtime.robot_group_layout import RobotGroupLayout, RobotMember


def test_two_arm_layout_round_trip() -> None:
    layout = RobotGroupLayout(
        [RobotMember("left", ("shoulder", "gripper")), RobotMember("right", ("shoulder", "gripper"))]
    )
    assert layout.joint_names == ("left.shoulder", "left.gripper", "right.shoulder", "right.gripper")
    assert layout.join({"right": (3, 4), "left": (1, 2)}) == (1.0, 2.0, 3.0, 4.0)
    assert layout.split((1, 2, 3, 4)) == {"left": (1.0, 2.0), "right": (3.0, 4.0)}


def test_single_arm_uses_same_mapping() -> None:
    layout = RobotGroupLayout([RobotMember("arm", ("elbow",))])
    assert layout.split(layout.join({"arm": (1.5,)})) == {"arm": (1.5,)}


@pytest.mark.parametrize(
    "members",
    [[], [RobotMember("left", ("a",)), RobotMember("left", ("b",))], [RobotMember("a.b", ("joint",))]],
)
def test_invalid_groups_are_rejected(members: list[RobotMember]) -> None:
    with pytest.raises(ValueError):
        RobotGroupLayout(members)


def test_mismatched_joint_count_is_rejected() -> None:
    layout = RobotGroupLayout([RobotMember("left", ("a", "b"))])
    with pytest.raises(ValueError):
        layout.join({"left": (1,)})
    with pytest.raises(ValueError):
        layout.split((1,))
