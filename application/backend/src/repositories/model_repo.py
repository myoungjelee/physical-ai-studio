from collections.abc import Callable
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import update
from sqlalchemy.ext.asyncio.session import AsyncSession

from db.schema import ModelDB
from repositories.base import BaseRepository
from repositories.mappers import ModelMapper
from schemas import Model


class ModelRepository(BaseRepository):
    def __init__(self, db: AsyncSession):
        super().__init__(db, ModelDB)

    @property
    def to_schema(self) -> Callable[[Model], ModelDB]:
        return ModelMapper.to_schema

    @property
    def from_schema(self) -> Callable[[ModelDB], Model]:
        return ModelMapper.from_schema

    async def get_project_models(self, project_id: UUID) -> list[Model]:
        return await self.get_all(
            extra_filters={"project_id": str(project_id)},
        )

    async def update_metadata(self, model_id: UUID, metadata: dict) -> Model:
        """Update only editable columns; never serialize unrelated dates or checkpoint fields."""
        await self.db.execute(
            update(ModelDB).where(ModelDB.id == str(model_id)).values(**metadata, updated_at=datetime.now(UTC))
        )
        await self.db.commit()
        updated = await self.get_by_id(model_id)
        if updated is None:
            raise ValueError(f"Model with ID {model_id} disappeared during metadata update")
        return updated
