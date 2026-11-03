# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""DINOv2 vision-encoder contract for first-party ACT."""

# ruff: noqa: S101, PLC2701, D107, D102, D103

from __future__ import annotations

from types import SimpleNamespace
from typing import TYPE_CHECKING
from unittest.mock import patch

import pytest
import torch
from torch import nn

from physicalai.policies.act.model import _ACTConfig, _Dinov2FeatureMap

if TYPE_CHECKING:
    from pathlib import Path


class FakeDinov2Model(nn.Module):
    """Small deterministic stand-in for Hugging Face weights in offline unit tests."""

    requested_repo: str | None = None
    requested_cache: str | None = None

    def __init__(self, config: object) -> None:
        super().__init__()
        self.hidden_size = config.hidden_size  # type: ignore[attr-defined]
        self.anchor = nn.Parameter(torch.tensor(1.0))

    @classmethod
    def from_pretrained(cls, repo: str, *, cache_dir: str | None = None) -> FakeDinov2Model:
        cls.requested_repo = repo
        cls.requested_cache = cache_dir
        width = 384 if repo.endswith("small") else 768
        return cls(SimpleNamespace(hidden_size=width))

    def forward(self, pixel_values: torch.Tensor, *, interpolate_pos_encoding: bool) -> SimpleNamespace:
        assert interpolate_pos_encoding is True
        batch, _, height, width = pixel_values.shape
        num_tokens = 1 + (height // 14) * (width // 14)
        features = torch.ones(batch, num_tokens, self.hidden_size, device=pixel_values.device)
        return SimpleNamespace(last_hidden_state=features)


@pytest.mark.parametrize(
    ("variant", "repository", "channels"),
    [
        ("dinov2_small", "facebook/dinov2-small", 384),
        ("dinov2_base", "facebook/dinov2-base", 768),
    ],
)
def test_pretrained_variants_project_patches_to_feature_maps(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    variant: str,
    repository: str,
    channels: int,
) -> None:
    monkeypatch.setenv("PAI_DINOV2_CACHE_DIR", str(tmp_path))
    with patch("transformers.Dinov2Model", FakeDinov2Model):
        encoder = _Dinov2FeatureMap(variant, pretrained=True)
        output = encoder(torch.zeros(2, 3, 224, 224))["feature_map"]

    assert FakeDinov2Model.requested_repo == repository
    assert FakeDinov2Model.requested_cache == str(tmp_path)
    assert output.shape == (2, channels, 16, 16)
    assert all(not param.requires_grad for param in encoder.parameters())


@pytest.mark.parametrize("variant", ["dinov2_small", "dinov2_base"])
def test_checkpoint_backbone_construction_never_requires_hub_weights(variant: str) -> None:
    with patch("transformers.Dinov2Model", FakeDinov2Model):
        with patch.object(FakeDinov2Model, "from_pretrained", side_effect=AssertionError("Hub must not be accessed")):
            encoder = _Dinov2FeatureMap(variant, pretrained=False)
        assert encoder(torch.zeros(1, 3, 224, 224))["feature_map"].shape[-2:] == (16, 16)


def test_image_dimensions_must_align_with_patch_size() -> None:
    with patch("transformers.Dinov2Model", FakeDinov2Model):
        encoder = _Dinov2FeatureMap("dinov2_small", pretrained=False)
        with pytest.raises(ValueError, match="divisible by 14"):
            encoder(torch.zeros(1, 3, 225, 224))


@pytest.mark.parametrize("variant", ["resnet18", "dinov2_small", "dinov2_base"])
def test_act_config_accepts_supported_backbones(variant: str) -> None:
    assert _ACTConfig(vision_backbone=variant).vision_backbone == variant
