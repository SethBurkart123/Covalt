"""Provider auto-discovery system."""

from __future__ import annotations

import importlib
import pkgutil
from typing import Any, Callable, Dict, List

PROVIDERS: Dict[str, Dict[str, Callable]] = {}

# Auto-discover provider modules
for _, name, _ in pkgutil.iter_modules(__path__):
    try:
        module = importlib.import_module(f".{name}", __package__)
        get_func = getattr(module, f"get_{name}_model", None)
        fetch_func = getattr(module, "fetch_models", None)
        
        if get_func and fetch_func:
            PROVIDERS[name] = {"get_model": get_func, "fetch_models": fetch_func}
            print(f"✓ {name}")
    except Exception as e:
        print(f"✗ {name}: {e}")


def get_model(provider: str, model_id: str, **kwargs: Any) -> Any:
    """Get model instance for provider."""
    provider = _normalize(provider)
    
    if provider not in PROVIDERS:
        raise ValueError(f"Unknown provider: {provider}")
    
    return PROVIDERS[provider]["get_model"](model_id, **kwargs)


def fetch_provider_models(provider: str) -> List[Dict[str, Any]]:
    """Fetch available models for provider."""
    provider = _normalize(provider)
    return PROVIDERS[provider]["fetch_models"]() if provider in PROVIDERS else []


def list_providers() -> List[str]:
    """List all registered providers."""
    return list(PROVIDERS.keys())


def _normalize(provider: str) -> str:
    """Normalize provider name."""
    provider = provider.lower().strip().replace("-", "_")
    
    # Handle aliases
    aliases = {
        "google": "google",
        "gemini": "google",
        "google_ai_studio": "google",
        "openai_compatible": "openai_like",
        "openai-compatible": "openai_like"
    }
    return aliases.get(provider, provider)


__all__ = ["get_model", "fetch_provider_models", "list_providers"]

