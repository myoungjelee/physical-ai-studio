from pathlib import Path

import numpy as np
from lerobot.datasets.lerobot_dataset import LeRobotDataset

from internal_datasets.lerobot.editor import EpisodeEdit, apply_episode_edits


def _create_dataset(root: Path) -> None:
    features = {
        "observation.state": {"dtype": "float32", "shape": (2,), "names": ["x", "y"]},
        "action": {"dtype": "float32", "shape": (2,), "names": ["x", "y"]},
    }
    dataset = LeRobotDataset.create(
        repo_id="physicalai-studio/editor-test",
        root=root,
        fps=10,
        features=features,
        robot_type="test",
        use_videos=False,
    )
    for episode in range(3):
        for frame in range(5):
            values = np.array([episode, frame], dtype=np.float32)
            dataset.add_frame(
                {
                    "observation.state": values,
                    "action": values,
                    "task": f"task-{episode}",
                }
            )
        dataset.save_episode()
    dataset.finalize()


def test_trim_and_delete_rewrite_canonical_lerobot_data_with_a_backup(tmp_path: Path) -> None:
    root = tmp_path / "dataset"
    _create_dataset(root)
    original_data = next((root / "data").rglob("*.parquet"))
    original_inode = original_data.stat().st_ino

    backup = apply_episode_edits(
        root,
        [
            EpisodeEdit(episode_index=0, start_frame=1, end_frame=5),
            EpisodeEdit(episode_index=1, deleted=True),
        ],
        operation="test",
    )

    assert (backup / "manifest.json").is_file()
    backup_data = next((backup / "data").rglob("*.parquet"))
    assert backup_data.stat().st_ino == original_inode

    dataset = LeRobotDataset("physicalai-studio/editor-test", root=root)
    assert dataset.num_episodes == 2
    assert len(dataset) == 9
    assert dataset.meta.total_frames == 9

    episode_frames = [
        (int(dataset[index]["episode_index"]), int(dataset[index]["frame_index"])) for index in range(len(dataset))
    ]
    assert episode_frames == [(0, 0), (0, 1), (0, 2), (0, 3), (1, 0), (1, 1), (1, 2), (1, 3), (1, 4)]
    assert dataset[0]["action"].tolist() == [0.0, 1.0]
    assert dataset[4]["action"].tolist() == [2.0, 0.0]
