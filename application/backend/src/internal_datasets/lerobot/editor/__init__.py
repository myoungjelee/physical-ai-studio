"""Non-video LeRobot v3 dataset edits.

The editor rewrites canonical LeRobot tabular metadata and data while retaining
the original video files.  Expensive video compaction is deliberately a
separate operation.
"""

from .apply import EpisodeEdit, apply_episode_edits

__all__ = ["EpisodeEdit", "apply_episode_edits"]
