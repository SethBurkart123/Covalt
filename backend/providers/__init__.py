"""
Provider Auto-Discovery System

Automatically discovers and registers all provider modules in this directory.
Each provider exports two functions:
  - get_<provider>_model(): Creates a model instance
  - fetch_models(): Fetches available models from the API

Providers can optionally define ALIASES for alternative names.
"""

from __future__ import annotations

import importlib
import inspect
import pkgutil
from typing import Any, Callable, Dict, List, Optional, Tuple

from .. import db

# Registry of all discovered providers
PROVIDERS: Dict[str, Dict[str, Callable]] = {}
ALIASES: Dict[str, str] = {}


# ========================================
# Shared Utilities for Providers
# ========================================
# MUST be defined BEFORE discovery loop
# so providers can import them
# ========================================


def get_credentials() -> Tuple[Optional[str], Optional[str]]:
    """Get API credentials for the calling provider. Auto-detects provider from filename."""
    provider = _get_caller_provider()

    with db.db_session() as sess:
        settings = db.get_provider_settings(sess, provider)
        if settings:
            return settings.get("api_key"), settings.get("base_url")

    return None, None


def get_api_key() -> Optional[str]:
    """Get API key for the calling provider."""
    api_key, _ = get_credentials()
    return api_key


def get_base_url() -> Optional[str]:
    """Get base URL for the calling provider."""
    _, base_url = get_credentials()
    return base_url


def get_extra_config() -> dict:
    """Get extra JSON configuration for the calling provider."""
    import json

    provider = _get_caller_provider()

    with db.db_session() as sess:
        settings = db.get_provider_settings(sess, provider)
        if settings and settings.get("extra"):
            extra = settings["extra"]
            return json.loads(extra) if isinstance(extra, str) else extra

    return {}


def _get_caller_provider() -> str:
    """Auto-detect provider name from calling module's filename."""
    frame = inspect.currentframe()

    while frame:
        frame = frame.f_back
        if frame and "__file__" in frame.f_globals:
            filename = frame.f_globals["__file__"].replace("\\", "/")

            if "providers/" in filename and filename.endswith(".py"):
                provider = filename.split("/")[-1].replace(".py", "")
                if provider != "__init__":
                    return provider

    raise RuntimeError("Could not detect provider name from caller")


# ========================================
# Auto-Discovery
# ========================================
# Now that utilities are defined, we can
# safely import provider modules
# ========================================

for _, name, _ in pkgutil.iter_modules(__path__):
    try:
        module = importlib.import_module(f".{name}", __package__)

        # Look for required functions
        get_func = getattr(module, f"get_{name}_model", None)
        fetch_func = getattr(module, "fetch_models", None)
        test_func = getattr(module, "test_connection", None)

        if get_func and fetch_func:
            PROVIDERS[name] = {
                "get_model": get_func,
                "fetch_models": fetch_func,
                "test_connection": test_func,
            }

            # Register optional aliases
            if hasattr(module, "ALIASES"):
                for alias in module.ALIASES:
                    ALIASES[alias] = name

            print(f"✓ {name}")
        else:
            print(f"⚠ {name} missing required functions")

    except Exception as e:
        print(f"✗ {name}: {e}")


# ========================================
# Public API
# ========================================


def get_model(provider: str, model_id: str, **kwargs: Any) -> Any:
    """Create a model instance for the specified provider."""
    provider = _normalize(provider)

    if provider not in PROVIDERS:
        available = ", ".join(PROVIDERS.keys())
        raise ValueError(f"Unknown provider '{provider}'. Available: {available}")

    return PROVIDERS[provider]["get_model"](model_id, **kwargs)


async def fetch_provider_models(provider: str) -> List[Dict[str, Any]]:
    """Fetch all available models from a provider's API."""
    provider = _normalize(provider)

    if provider not in PROVIDERS:
        return []

    return await PROVIDERS[provider]["fetch_models"]()


def list_providers() -> List[str]:
    """Get list of all registered provider names."""
    return list(PROVIDERS.keys())


def _normalize(provider: str) -> str:
    """Normalize provider name and resolve aliases."""
    provider = provider.lower().strip().replace("-", "_")
    return ALIASES.get(provider, provider)


async def test_provider_connection(provider: str) -> tuple[bool, str | None]:
    """Test connection to a provider. Returns (success, error_message)."""
    provider = _normalize(provider)

    if provider not in PROVIDERS:
        return False, f"Unknown provider '{provider}'"

    test_func = PROVIDERS[provider].get("test_connection")
    if not test_func:
        return False, "Provider does not support connection testing"

    return await test_func()


__all__ = [
    "get_model",
    "fetch_provider_models",
    "test_provider_connection",
    "list_providers",
    "get_credentials",
    "get_api_key",
    "get_base_url",
    "get_extra_config",
]
