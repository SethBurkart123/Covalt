from __future__ import annotations

import asyncio
from typing import Any, Dict, List

from ..providers import get_model as get_provider_model
from ..providers import fetch_provider_models, list_providers
from .. import db


def get_model(provider: str, model_id: str, **kwargs: Any) -> Any:
    return get_provider_model(provider, model_id, **kwargs)


def list_supported_providers() -> List[str]:
    return list_providers()


async def get_available_models() -> tuple[List[Dict[str, Any]], List[str]]:
    configured = _get_configured_providers()
    enabled = [(p, c) for p, c in configured.items() if c.get("enabled", True)]

    if not enabled:
        return [], []

    connected: List[str] = []

    async def fetch_one(provider: str) -> List[Dict[str, Any]]:
        try:
            models = await fetch_provider_models(provider)
            if models:
                connected.append(provider)
            return [
                {
                    "provider": provider,
                    "modelId": m["id"],
                    "displayName": m["name"],
                    "isDefault": False,
                }
                for m in models
            ]
        except Exception as e:
            print(f"[{provider}] Error fetching models: {e}")
            return []

    results = await asyncio.gather(*[fetch_one(p) for p, _ in enabled])
    models = [m for batch in results for m in batch]

    if models:
        models[0]["isDefault"] = True

    return models, connected


def _get_configured_providers() -> Dict[str, Dict[str, Any]]:
    with db.db_session() as sess:
        return db.get_all_provider_settings(sess)
