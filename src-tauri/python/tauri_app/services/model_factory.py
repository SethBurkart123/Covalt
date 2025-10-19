"""
Model Factory for multi-provider support.

Provides abstraction layer to instantiate models from different providers
(OpenAI, Anthropic, Groq, Ollama) dynamically based on configuration.
"""
from __future__ import annotations

from typing import Any, Dict, Optional
from ..config import get_env


def get_model(provider: str, model_id: str, app_handle: Any = None, **kwargs: Any) -> Any:
    """
    Factory function to instantiate models from different providers.
    
    Args:
        provider: Model provider name (openai, anthropic, groq, ollama)
        model_id: Specific model identifier (e.g., "gpt-4o", "claude-3-5-sonnet-20241022")
        app_handle: Optional Tauri app handle for database access to get API keys
        **kwargs: Additional model configuration (temperature, max_tokens, etc.)
    
    Returns:
        Configured model instance
        
    Raises:
        ValueError: If provider is not supported
        RuntimeError: If required API keys are missing
    """
    provider = provider.lower().strip()
    
    if provider == "openai":
        return _get_openai_model(model_id, app_handle, **kwargs)
    elif provider == "anthropic":
        return _get_anthropic_model(model_id, app_handle, **kwargs)
    elif provider == "groq":
        return _get_groq_model(model_id, app_handle, **kwargs)
    elif provider == "ollama":
        return _get_ollama_model(model_id, app_handle, **kwargs)
    else:
        raise ValueError(
            f"Unsupported provider: {provider}. "
            f"Supported providers: openai, anthropic, groq, ollama"
        )


def _get_api_key_for_provider(provider: str, app_handle: Any = None) -> tuple[str | None, str | None]:
    """
    Get API key and base URL for a provider from env or database.
    
    Returns:
        Tuple of (api_key, base_url)
    """
    # First check environment variables
    api_key = None
    base_url = None
    
    if provider == "openai":
        api_key = get_env("OPENAI_API_KEY")
        base_url = get_env("OPENAI_API_BASE_URL") or get_env("OPENAI_BASE_URL")
    elif provider == "anthropic":
        api_key = get_env("ANTHROPIC_API_KEY")
    elif provider == "groq":
        api_key = get_env("GROQ_API_KEY")
    elif provider == "ollama":
        base_url = get_env("OLLAMA_HOST") or "http://localhost:11434"
    
    # Check database settings if env not found
    if not api_key and app_handle:
        try:
            from .. import db
            sess = db.session(app_handle)
            try:
                settings = db.get_provider_settings(sess, provider)
                if settings:
                    api_key = settings.get("api_key") or api_key
                    base_url = settings.get("base_url") or base_url
            finally:
                sess.close()
        except Exception as e:
            print(f"[ModelFactory] Warning: Failed to check DB for {provider} settings: {e}")
    
    return api_key, base_url


def _get_openai_model(model_id: str, app_handle: Any = None, **kwargs: Any) -> Any:
    """Create OpenAI model instance."""
    try:
        from agno.models.openai import OpenAIChat
    except ImportError as e:
        raise RuntimeError(
            "The 'agno' package with OpenAI support is required. "
            "Install it with: pip install 'agno[openai]>=2.0.0'"
        ) from e
    
    api_key, base_url = _get_api_key_for_provider("openai", app_handle)
    
    if not api_key:
        raise RuntimeError(
            "OPENAI_API_KEY not found. "
            "Please set it as an environment variable or configure it in Settings."
        )
    
    return OpenAIChat(
        id=model_id,
        api_key=api_key,
        base_url=base_url,
        **kwargs
    )


def _get_anthropic_model(model_id: str, app_handle: Any = None, **kwargs: Any) -> Any:
    """Create Anthropic Claude model instance."""
    try:
        from agno.models.anthropic import Claude
    except ImportError as e:
        raise RuntimeError(
            "The 'agno' package with Anthropic support is required. "
            "Install it with: pip install 'agno[anthropic]>=2.0.0'"
        ) from e
    
    api_key, _ = _get_api_key_for_provider("anthropic", app_handle)
    
    if not api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY not found. "
            "Please set it as an environment variable or configure it in Settings."
        )
    
    return Claude(
        id=model_id,
        api_key=api_key,
        **kwargs
    )


def _get_groq_model(model_id: str, app_handle: Any = None, **kwargs: Any) -> Any:
    """Create Groq model instance."""
    try:
        from agno.models.groq import Groq
    except ImportError as e:
        raise RuntimeError(
            "The 'agno' package with Groq support is required. "
            "Install it with: pip install 'agno[groq]>=2.0.0'"
        ) from e
    
    api_key, _ = _get_api_key_for_provider("groq", app_handle)
    
    if not api_key:
        raise RuntimeError(
            "GROQ_API_KEY not found. "
            "Please set it as an environment variable or configure it in Settings."
        )
    
    return Groq(
        id=model_id,
        api_key=api_key,
        **kwargs
    )


def _get_ollama_model(model_id: str, app_handle: Any = None, **kwargs: Any) -> Any:
    """Create Ollama model instance (local)."""
    try:
        from agno.models.ollama import Ollama
    except ImportError as e:
        raise RuntimeError(
            "The 'agno' package with Ollama support is required. "
            "Install it with: pip install 'agno[ollama]>=2.0.0'"
        ) from e
    
    _, host = _get_api_key_for_provider("ollama", app_handle)
    if not host:
        host = "http://localhost:11434"
    
    return Ollama(
        id=model_id,
        host=host,
        **kwargs
    )


def list_supported_providers() -> list[str]:
    """Return list of supported provider names."""
    return ["openai", "anthropic", "groq", "ollama"]


def get_default_model_for_provider(provider: str) -> str:
    """Return a sensible default model ID for each provider."""
    defaults: Dict[str, str] = {
        "openai": "gpt-4o-mini",
        "anthropic": "claude-3-5-sonnet-20241022",
        "groq": "llama-3.1-70b-versatile",
        "ollama": "llama3.2",
    }
    return defaults.get(provider.lower(), "gpt-4o-mini")


# Fallback model names for display (used if API fetch fails)
FALLBACK_MODEL_NAMES: Dict[str, str] = {
    "gpt-4o": "GPT-4o",
    "gpt-4o-mini": "GPT-4o Mini",
    "gpt-4-turbo": "GPT-4 Turbo",
    "claude-3-5-sonnet-20241022": "Claude 3.5 Sonnet",
    "claude-3-5-haiku-20241022": "Claude 3.5 Haiku",
    "llama-3.3-70b-versatile": "Llama 3.3 70B",
    "llama-3.1-70b-versatile": "Llama 3.1 70B",
}


def _fetch_openai_models(api_key: str, base_url: Optional[str] = None) -> list[Dict[str, str]]:
    """Fetch available models from OpenAI API."""
    try:
        import requests
        url = f"{base_url or 'https://api.openai.com'}/v1/models"
        headers = {"Authorization": f"Bearer {api_key}"}
        response = requests.get(url, headers=headers, timeout=5)
        if response.status_code == 200:
            data = response.json()
            models = []
            for model in data.get("data", []):
                model_id = model.get("id", "")
                # Filter to chat models
                if any(x in model_id for x in ["gpt-", "o1-"]):
                    display_name = FALLBACK_MODEL_NAMES.get(model_id, model_id)
                    models.append({"id": model_id, "name": display_name})
            return models
    except Exception as e:
        print(f"[ModelFactory] Failed to fetch OpenAI models: {e}")
    return []


def _fetch_groq_models(api_key: str) -> list[Dict[str, str]]:
    """Fetch available models from Groq API."""
    try:
        import requests
        url = "https://api.groq.com/openai/v1/models"
        headers = {"Authorization": f"Bearer {api_key}"}
        response = requests.get(url, headers=headers, timeout=5)
        if response.status_code == 200:
            data = response.json()
            models = []
            for model in data.get("data", []):
                model_id = model.get("id", "")
                display_name = FALLBACK_MODEL_NAMES.get(model_id, model_id)
                models.append({"id": model_id, "name": display_name})
            return models
    except Exception as e:
        print(f"[ModelFactory] Failed to fetch Groq models: {e}")
    return []


def _fetch_ollama_models(host: str) -> list[Dict[str, str]]:
    """Fetch available models from Ollama API."""
    try:
        import requests
        url = f"{host}/api/tags"
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            data = response.json()
            models = []
            for model in data.get("models", []):
                model_name = model.get("name", "")
                if model_name:
                    # Clean up display name (remove :latest tags etc)
                    display_name = model_name.split(":")[0].capitalize()
                    models.append({"id": model_name, "name": display_name})
            return models
    except Exception as e:
        print(f"[ModelFactory] Failed to fetch Ollama models: {e}")
    return []


def _get_anthropic_models() -> list[Dict[str, str]]:
    """Return Anthropic models (they don't have a public models API)."""
    return [
        {"id": "claude-3-5-sonnet-20241022", "name": "Claude 3.5 Sonnet"},
        {"id": "claude-3-5-haiku-20241022", "name": "Claude 3.5 Haiku"},
        {"id": "claude-3-opus-20240229", "name": "Claude 3 Opus"},
        {"id": "claude-3-sonnet-20240229", "name": "Claude 3 Sonnet"},
        {"id": "claude-3-haiku-20240307", "name": "Claude 3 Haiku"},
    ]


def get_model_display_name(provider: str, model_id: str) -> str:
    """
    Get friendly display name for a model.
    
    Args:
        provider: Provider name (openai, anthropic, groq, ollama)
        model_id: Model identifier
        
    Returns:
        Display name if found, otherwise the model_id
    """
    return FALLBACK_MODEL_NAMES.get(model_id, model_id)


def get_available_models(app_handle: Any = None) -> list[Dict[str, Any]]:
    """
    Get list of available models based on configured providers.
    
    Dynamically fetches models from provider APIs.
    
    Args:
        app_handle: Optional Tauri app handle for database access
        
    Returns:
        List of model info dicts with provider, modelId, displayName, isDefault
    """
    models: list[Dict[str, Any]] = []
    default_provider = None
    default_model = None
    
    # Check environment variables first
    env_providers = _check_env_providers()
    
    # Check database settings if app_handle provided
    db_providers = {}
    if app_handle:
        db_providers = _check_db_providers(app_handle)
    
    # Merge providers (DB settings override env)
    all_providers = {**env_providers, **db_providers}
    
    # Fetch models dynamically for each configured provider
    for provider, config in all_providers.items():
        if not config.get("enabled", True):
            continue
        
        provider_models = []
        
        try:
            if provider == "openai":
                api_key = config.get("api_key")
                base_url = config.get("base_url")
                if api_key:
                    provider_models = _fetch_openai_models(api_key, base_url)
            
            elif provider == "anthropic":
                if config.get("api_key"):
                    provider_models = _get_anthropic_models()
            
            elif provider == "groq":
                api_key = config.get("api_key")
                if api_key:
                    provider_models = _fetch_groq_models(api_key)
            
            elif provider == "ollama":
                host = config.get("base_url", "http://localhost:11434")
                provider_models = _fetch_ollama_models(host)
        
        except Exception as e:
            print(f"[ModelFactory] Error fetching models for {provider}: {e}")
            continue
        
        # Add fetched models to list
        for model_info in provider_models:
            is_default = (default_provider is None and default_model is None)
            if is_default:
                default_provider = provider
                default_model = model_info["id"]
                
            models.append({
                "provider": provider,
                "modelId": model_info["id"],
                "displayName": model_info["name"],
                "isDefault": is_default,
            })
    
    return models


def _check_env_providers() -> Dict[str, Dict[str, Any]]:
    """Check which providers are configured via environment variables."""
    providers = {}
    
    if get_env("OPENAI_API_KEY"):
        providers["openai"] = {
            "enabled": True,
            "api_key": get_env("OPENAI_API_KEY"),
            "base_url": get_env("OPENAI_API_BASE_URL") or get_env("OPENAI_BASE_URL"),
        }
    
    if get_env("ANTHROPIC_API_KEY"):
        providers["anthropic"] = {
            "enabled": True,
            "api_key": get_env("ANTHROPIC_API_KEY"),
        }
    
    if get_env("GROQ_API_KEY"):
        providers["groq"] = {
            "enabled": True,
            "api_key": get_env("GROQ_API_KEY"),
        }
    
    # Ollama is always available if host is reachable (default to localhost)
    ollama_host = get_env("OLLAMA_HOST") or "http://localhost:11434"
    providers["ollama"] = {
        "enabled": True,
        "base_url": ollama_host,
    }
    
    return providers


def _check_db_providers(app_handle: Any) -> Dict[str, Dict[str, Any]]:
    """Check which providers are configured in database."""
    try:
        from .. import db
        
        sess = db.session(app_handle)
        try:
            settings = db.get_all_provider_settings(sess)
            return settings
        finally:
            sess.close()
    except Exception as e:
        print(f"[ModelFactory] Warning: Failed to check DB providers: {e}")
        return {}

