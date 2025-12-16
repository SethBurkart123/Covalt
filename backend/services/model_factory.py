"""Model factory using LiteLLM provider system."""

from __future__ import annotations

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


def get_available_models() -> List[Dict[str, Any]]:
    """Get all available models from configured providers."""
    models = []
    configured_providers = _get_configured_providers()
    
    for provider, config in configured_providers.items():
        if not config.get("enabled", True):
            continue
        
        try:
            provider_models = fetch_provider_models(provider)
            models.extend([
                {
                    "provider": provider,
                    "modelId": m["id"],
                    "displayName": m["name"],
                    "isDefault": len(models) == 0  # First model is default
                }
                for m in provider_models
            ])
        except Exception as e:
            print(f"[{provider}] Error fetching models: {e}")
    
    return models


def _get_configured_providers() -> Dict[str, Dict[str, Any]]:
    """Get configured providers from database."""
    try:
        with db.db_session() as sess:
            return db.get_all_provider_settings(sess)
    except Exception as e:
        print(f"[ModelFactory] DB error: {e}")
        return {}
