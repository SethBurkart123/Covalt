"""Model factory using LiteLLM provider system."""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List

from ..providers import get_model as get_provider_model
from ..providers import fetch_provider_models, list_providers
from .. import db


def get_model(provider: str, model_id: str, **kwargs: Any) -> Any:
    """Create model instance for provider."""
    return get_provider_model(provider, model_id, **kwargs)


def list_supported_providers() -> List[str]:
    """List all supported providers."""
    return list_providers()


async def get_available_models() -> List[Dict[str, Any]]:
    """Get all available models from configured providers (async, parallel)."""
    configured_providers = _get_configured_providers()
    enabled = [
        (provider, config) 
        for provider, config in configured_providers.items() 
        if config.get("enabled", True)
    ]
    
    if not enabled:
        return []
    
    async def fetch_one(provider: str) -> List[Dict[str, Any]]:
        """Fetch models from a single provider, handling errors gracefully."""
        try:
            provider_models = await fetch_provider_models(provider)
            return [
                {
                    "provider": provider,
                    "modelId": m["id"],
                    "displayName": m["name"],
                    "isDefault": False,
                }
                for m in provider_models
            ]
        except Exception as e:
            print(f"[{provider}] Error fetching models: {e}")
            return []
    
    # Fetch all providers in parallel!
    results = await asyncio.gather(*[fetch_one(p) for p, _ in enabled])
    
    # Flatten results
    models = []
    for provider_models in results:
        models.extend(provider_models)
    
    # Mark first model as default
    if models:
        models[0]["isDefault"] = True
    
    return models


def _get_configured_providers() -> Dict[str, Dict[str, Any]]:
    """Get configured providers from database."""
    try:
        with db.db_session() as sess:
            return db.get_all_provider_settings(sess)
    except Exception as e:
        print(f"[ModelFactory] DB error: {e}")
        return {}
