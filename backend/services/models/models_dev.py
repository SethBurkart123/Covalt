from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

import httpx

MODELS_DEV_URL = "https://models.dev/api.json"
MODELS_DEV_TTL_SECONDS = 300

_MODELS_DEV_CACHE: dict[str, Any] | None = None
_MODELS_DEV_LAST_FETCH = 0.0


async def fetch_models_dev_provider(
    provider_key: str,
    predicate: Callable[[str, dict[str, Any]], bool] | None = None,
) -> list[dict[str, str]]:
    data = await _load_models_dev_data()
    if not data:
        return []

    provider = data.get(provider_key) or {}
    models = provider.get("models") or {}
    if not isinstance(models, dict):
        return []

    results: list[dict[str, str]] = []
    for model_id, model_info in models.items():
        if not isinstance(model_id, str):
            continue
        info = model_info if isinstance(model_info, dict) else {}
        if predicate and not predicate(model_id, info):
            continue
        name = info.get("name") or model_id
        results.append({"id": model_id, "name": name})

    return results


async def _load_models_dev_data() -> dict[str, Any]:
    global _MODELS_DEV_CACHE
    global _MODELS_DEV_LAST_FETCH

    now = time.time()
    if _MODELS_DEV_CACHE and now - _MODELS_DEV_LAST_FETCH < MODELS_DEV_TTL_SECONDS:
        return _MODELS_DEV_CACHE

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(MODELS_DEV_URL)
            if not response.is_success:
                return {}
            data = response.json()
            if not isinstance(data, dict):
                return {}
            _MODELS_DEV_CACHE = data
            _MODELS_DEV_LAST_FETCH = now
            return data
    except Exception as exc:
        print(f"[models.dev] Failed to fetch models: {exc}")
        return {}
