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
    """
    Get API credentials for the calling provider.
    Auto-detects provider name from calling module filename.
    
    Returns:
        (api_key, base_url) tuple
    """
    provider = _get_caller_provider()
    
    try:
        with db.db_session() as sess:
            settings = db.get_provider_settings(sess, provider)
            if settings:
                return settings.get("api_key"), settings.get("base_url")
    except Exception as e:
        print(f"[{provider}] Failed to get credentials: {e}")
    
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
    """
    Get extra JSON configuration for the calling provider.
    Used for provider-specific settings like Vertex AI config.
    """
    import json
    
    provider = _get_caller_provider()
    
    try:
        with db.db_session() as sess:
            settings = db.get_provider_settings(sess, provider)
            if settings and settings.get("extra"):
                extra = settings.get("extra")
                return json.loads(extra) if isinstance(extra, str) else extra
    except Exception as e:
        print(f"[{provider}] Failed to get extra config: {e}")
    
    return {}


def _get_caller_provider() -> str:
    """
    Auto-detect provider name from calling module's filename.
    
    Example: Called from 'groq.py' returns 'groq'
    """
    import os
    frame = inspect.currentframe()
    
    while frame:
        frame = frame.f_back
        if frame and "__file__" in frame.f_globals:
            filename = frame.f_globals["__file__"]
            
            # Normalize path separators for cross-platform
            filename = filename.replace("\\", "/")
            
            # Extract provider name from path
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
                "test_connection": test_func
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
    """
    Create a model instance for the specified provider.
    
    Args:
        provider: Provider name (e.g., 'openai', 'anthropic')
        model_id: Model identifier (e.g., 'gpt-4o')
        **kwargs: Additional model parameters
    
    Returns:
        Configured LiteLLM model instance
    
    Example:
        model = get_model("openai", "gpt-4o", temperature=0.7)
    """
    provider = _normalize(provider)
    
    if provider not in PROVIDERS:
        available = ", ".join(PROVIDERS.keys())
        raise ValueError(f"Unknown provider '{provider}'. Available: {available}")
    
    return PROVIDERS[provider]["get_model"](model_id, **kwargs)


def fetch_provider_models(provider: str) -> List[Dict[str, Any]]:
    """
    Fetch all available models from a provider's API.
    
    Args:
        provider: Provider name
    
    Returns:
        List of model dicts with 'id' and 'name' keys
    """
    provider = _normalize(provider)
    
    if provider not in PROVIDERS:
        return []
    
    return PROVIDERS[provider]["fetch_models"]()


def list_providers() -> List[str]:
    """Get list of all registered provider names."""
    return list(PROVIDERS.keys())


def _normalize(provider: str) -> str:
    """Normalize provider name and resolve aliases."""
    provider = provider.lower().strip().replace("-", "_")
    return ALIASES.get(provider, provider)


def test_provider_connection(provider: str) -> tuple[bool, str | None]:
    """
    Test connection to a provider.
    
    Args:
        provider: Provider name (e.g., 'openai', 'ollama')
    
    Returns:
        (success, error_message) tuple where error is None on success
    
    Example:
        success, error = test_provider_connection("ollama")
        if not success:
            print(f"Connection failed: {error}")
    """
    provider = _normalize(provider)
    
    if provider not in PROVIDERS:
        return False, f"Unknown provider '{provider}'"
    
    test_func = PROVIDERS[provider].get("test_connection")
    
    if not test_func:
        return False, "Provider does not support connection testing"
    
    try:
        return test_func()
    except Exception as e:
        return False, f"Test failed: {str(e)[:100]}"


__all__ = [
    "get_model",
    "fetch_provider_models",
    "test_provider_connection",
    "list_providers",
    "get_credentials",
    "get_api_key",
    "get_base_url",
    "get_extra_config"
]
