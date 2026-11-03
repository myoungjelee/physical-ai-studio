"""Regression tests for user-editable model metadata."""

from pathlib import Path
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from api.dependencies import get_model_service
from main import app
from schemas.model import Model, ModelMetadataUpdate


def make_model(tmp_path: Path) -> Model:
    return Model(
        id=uuid4(),
        name="ACT",
        path=str(tmp_path / "checkpoint"),
        policy="act",
        properties={"lora_enabled": False},
        project_id=uuid4(),
        dataset_id=None,
        snapshot_id=None,
        version=2,
    )


def test_metadata_validation() -> None:
    assert ModelMetadataUpdate(name="  Test  ", tags=["  pick ", "shadow"]).name == "Test"
    with pytest.raises(ValidationError):
        ModelMetadataUpdate(name=" ")
    with pytest.raises(ValidationError):
        ModelMetadataUpdate(name="ACT", tags=["Pick", "pick"])
    with pytest.raises(ValidationError):
        ModelMetadataUpdate(name="ACT", tags=["x" * 41])


def test_metadata_update_preserves_model_identity(tmp_path: Path) -> None:
    model = make_model(tmp_path)
    service = AsyncMock()
    service.get_model_by_id.return_value = model

    async def update(existing: Model, patch: dict) -> Model:
        return existing.model_copy(update=patch)

    service.update_model_metadata.side_effect = update
    app.dependency_overrides[get_model_service] = lambda: service
    try:
        response = TestClient(app).patch(
            f"/api/models/{model.id}",
            json={"name": "ACT Left", "description": "Shadow experiment", "tags": ["shadow"]},
        )
        assert response.status_code == 200, response.text
        updated = response.json()
        assert updated["name"] == "ACT Left"
        assert updated["description"] == "Shadow experiment"
        assert updated["tags"] == ["shadow"]
        assert updated["id"] == str(model.id)
        assert updated["path"] == model.path
        assert updated["version"] == 2
        assert updated["policy"] == "act"
        assert service.update_model_metadata.await_args.args[1] == {
            "name": "ACT Left",
            "description": "Shadow experiment",
            "tags": ["shadow"],
        }
    finally:
        app.dependency_overrides.clear()


def test_metadata_api_ignores_internal_fields(tmp_path: Path) -> None:
    model = make_model(tmp_path)
    service = AsyncMock()
    service.get_model_by_id.return_value = model
    service.update_model_metadata.side_effect = lambda item, fields: item.model_copy(update=fields)
    app.dependency_overrides[get_model_service] = lambda: service
    try:
        response = TestClient(app).patch(
            f"/api/models/{model.id}",
            json={"name": "New name", "path": "/tmp/other", "version": 100},
        )
        assert response.status_code == 200
        assert response.json()["path"] == model.path
        assert response.json()["version"] == 2
    finally:
        app.dependency_overrides.clear()
