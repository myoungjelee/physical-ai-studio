from uuid import UUID

from pydantic import BaseModel


class DatasetOptimizationJobPayload(BaseModel):
    """Persistent input/output state for a video-compaction job."""

    dataset_id: UUID
    backup_path: str | None = None
