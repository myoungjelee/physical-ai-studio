"""Regression coverage for importing Studio-exported model ZIP files."""

import io
import json
import zipfile
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException, UploadFile

from api import models


def _archive(*, enclosing_folder: str = "") -> bytes:
    output = io.BytesIO()
    manifest = {
        "format": "policy_package",
        "policy": {"name": "act"},
        "model": {"artifacts": {"torch": "act.pt"}},
    }
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr(f"{enclosing_folder}model.ckpt", "checkpoint")
        archive.writestr(f"{enclosing_folder}exports/torch/manifest.json", json.dumps(manifest))
        archive.writestr(f"{enclosing_folder}exports/torch/act.pt", "weights")
    return output.getvalue()


@pytest.mark.anyio
@pytest.mark.parametrize("enclosing_folder", ["", "ACT/"])
async def test_import_model_zip_calls_existing_import_service(monkeypatch, tmp_path, enclosing_folder):
    settings = SimpleNamespace(
        storage_dir=tmp_path,
        data_import_max_upload_bytes=100000,
        data_import_max_uncompressed_bytes=100000,
        data_import_min_free_bytes=0,
    )
    monkeypatch.setattr(models, "get_settings", lambda: settings)

    async def import_directory(**kwargs):
        source = kwargs["source_dir"]
        assert (source / "model.ckpt").read_text() == "checkpoint"
        assert (source / "exports/torch/act.pt").read_text() == "weights"
        assert kwargs["model_name"] == "ACT Bimanual"
        return {"id": "imported"}

    importer = SimpleNamespace(import_model_directory=AsyncMock(side_effect=import_directory))
    monkeypatch.setattr(models, "ModelImportService", lambda **kwargs: importer)
    result = await models.import_model_zip(
        None,
        uuid4(),
        uuid4(),
        "ACT Bimanual",
        UploadFile(filename="ACT.zip", file=io.BytesIO(_archive(enclosing_folder=enclosing_folder))),
    )
    assert result == {"id": "imported"}
    assert importer.import_model_directory.await_count == 1
    assert not list((tmp_path / "cache" / "imports" / "models").iterdir())


@pytest.mark.anyio
async def test_import_model_zip_rejects_corrupt_archive(monkeypatch, tmp_path):
    settings = SimpleNamespace(
        storage_dir=tmp_path,
        data_import_max_upload_bytes=100000,
        data_import_max_uncompressed_bytes=100000,
        data_import_min_free_bytes=0,
    )
    monkeypatch.setattr(models, "get_settings", lambda: settings)
    with pytest.raises(HTTPException) as exc:
        await models.import_model_zip(
            None,
            uuid4(),
            uuid4(),
            "ACT",
            UploadFile(filename="ACT.zip", file=io.BytesIO(b"invalid zip")),
        )
    assert exc.value.status_code == 400
