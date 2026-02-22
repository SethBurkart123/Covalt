from __future__ import annotations

import logging
from typing import Any

from ..models.chat import OptionSchema
from ..providers import get_provider_model_options

logger = logging.getLogger(__name__)

# Key: "provider:model_id", Value: metadata dictionary from latest model fetch.
_model_metadata_cache: dict[str, dict[str, Any]] = {}


def cache_model_metadata(provider: str, model_id: str, metadata: dict[str, Any]) -> None:
    key = f"{provider}:{model_id}"
    _model_metadata_cache[key] = dict(metadata)


def get_cached_model_metadata(provider: str, model_id: str) -> dict[str, Any] | None:
    key = f"{provider}:{model_id}"
    cached = _model_metadata_cache.get(key)
    if cached is None:
        return None
    return dict(cached)


def get_effective_option_schema(provider: str, model_id: str) -> OptionSchema:
    """Return schema used for request-time validation, with safe fallbacks."""
    metadata = get_cached_model_metadata(provider, model_id)
    if metadata is None:
        logger.warning(
            "No cached metadata for %s:%s. Using schema without metadata.",
            provider,
            model_id,
        )

    try:
        schema_dict = get_provider_model_options(provider, model_id, metadata)
        return OptionSchema.model_validate(schema_dict)
    except Exception as exc:
        logger.error(
            "Failed to get option schema for %s:%s: %s",
            provider,
            model_id,
            exc,
        )
        return OptionSchema(main=[], advanced=[])
