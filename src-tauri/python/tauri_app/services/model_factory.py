"""
Model Factory for multi-provider support.

Provides abstraction layer to instantiate models from different providers
(OpenAI, Anthropic, Groq, Ollama, vLLM, LM Studio, OpenAI-compatible) dynamically based on configuration.
"""
from __future__ import annotations
import json
from typing import Any, Dict, Optional
import requests

from .. import db

from agno.models.openai import OpenAIChat
from agno.models.openai.like import OpenAILike
from agno.models.anthropic import Claude
from agno.models.groq import Groq
from agno.models.ollama import Ollama
from agno.models.vllm import VLLM
from agno.models.google import Gemini
from agno.models.lmstudio import LMStudio


def get_model(provider: str, model_id: str, app_handle: Any = None, **kwargs: Any) -> Any:
    """
    Factory function to instantiate models from different providers.
    
    Args:
        provider: Model provider name (openai, anthropic, groq, ollama, vllm, lmstudio, openai_like)
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
    elif provider == "vllm":
        return _get_vllm_model(model_id, app_handle, **kwargs)
    elif provider == "lmstudio":
        return _get_lmstudio_model(model_id, app_handle, **kwargs)
    elif provider in ("google", "gemini", "google_ai_studio"):
        return _get_google_model(model_id, app_handle, **kwargs)
    elif provider in ("openai_like", "openai-compatible", "openai_compatible"):
        return _get_openai_like_model(model_id, app_handle, **kwargs)
    else:
        raise ValueError(
            f"Unsupported provider: {provider}. "
            f"Supported providers: openai, anthropic, groq, ollama, vllm, lmstudio, google, openai_like"
        )


def _get_api_key_for_provider(provider: str, app_handle: Any = None) -> tuple[str | None, str | None]:
    """
    Get API key and base URL for a provider from database.
    
    Returns:
        Tuple of (api_key, base_url)
    """
    if not app_handle:
        return None, None
    
    api_key = None
    base_url = None
    
    try:
        with db.db_session(app_handle) as sess:
            settings = db.get_provider_settings(sess, provider)
            if settings:
                api_key = settings.get("api_key")
                base_url = settings.get("base_url")
    except Exception as e:
        print(f"[ModelFactory] Warning: Failed to check DB for {provider} settings: {e}")
    
    return api_key, base_url


def _get_openai_model(model_id: str, app_handle: Any = None, **kwargs: Any) -> Any:
    """Create OpenAI model instance."""
    api_key, base_url = _get_api_key_for_provider("openai", app_handle)
    
    if not api_key:
        raise RuntimeError(
            "OpenAI API key not found. Please configure it in Settings."
        )
    
    return OpenAIChat(
        id=model_id,
        api_key=api_key,
        base_url=base_url,
        **kwargs
    )


def _get_anthropic_model(model_id: str, app_handle: Any = None, **kwargs: Any) -> Any:
    """Create Anthropic Claude model instance."""
    api_key, _ = _get_api_key_for_provider("anthropic", app_handle)
    
    if not api_key:
        raise RuntimeError(
            "Anthropic API key not found. Please configure it in Settings."
        )
    
    return Claude(
        id=model_id,
        api_key=api_key,
        **kwargs
    )


def _get_groq_model(model_id: str, app_handle: Any = None, **kwargs: Any) -> Any:
    """Create Groq model instance."""
    api_key, _ = _get_api_key_for_provider("groq", app_handle)
    
    if not api_key:
        raise RuntimeError(
            "Groq API key not found. Please configure it in Settings."
        )
    
    return Groq(
        id=model_id,
        api_key=api_key,
        **kwargs
    )


def _get_ollama_model(model_id: str, app_handle: Any = None, **kwargs: Any) -> Any:
    """Create Ollama model instance (local)."""
    _, host = _get_api_key_for_provider("ollama", app_handle)
    
    if not host:
        raise RuntimeError(
            "Ollama host not configured. Please configure it in Settings."
        )
    
    return Ollama(
        id=model_id,
        host=host,
        **kwargs
    )


def _get_vllm_model(model_id: str, app_handle: Any = None, **kwargs: Any) -> Any:
    """Create vLLM model instance (OpenAI-compatible local server)."""
    api_key, base_url = _get_api_key_for_provider("vllm", app_handle)
    
    if not base_url:
        raise RuntimeError(
            "vLLM base URL not configured. Please configure it in Settings."
        )

    return VLLM(
        id=model_id,
        api_key=api_key,
        base_url=base_url,
        **kwargs
    )


def _get_lmstudio_model(model_id: str, app_handle: Any = None, **kwargs: Any) -> Any:
    """Create LM Studio model instance (OpenAI-compatible local server)."""
    api_key, base_url = _get_api_key_for_provider("lmstudio", app_handle)
    
    if not base_url:
        raise RuntimeError(
            "LM Studio base URL not configured. Please configure it in Settings."
        )

    return LMStudio(
        id=model_id,
        api_key=api_key,
        base_url=base_url,
        **kwargs
    )


def _get_openai_like_model(model_id: str, app_handle: Any = None, **kwargs: Any) -> Any:
    """Create a generic OpenAI-compatible model instance."""
    api_key, base_url = _get_api_key_for_provider("openai_like", app_handle)
    if not base_url:
        raise RuntimeError(
            "OpenAI-compatible provider requires a Base URL. "
            "Please configure it in Settings."
        )

    return OpenAILike(
        id=model_id,
        api_key=api_key,
        base_url=base_url,
        **kwargs
    )


def _get_google_model(model_id: str, app_handle: Any = None, **kwargs: Any) -> Any:
    """Create Google Gemini model instance (Google AI Studio or Vertex AI)."""
    # Pull config from DB only
    api_key, _ = _get_api_key_for_provider("google", app_handle)
    
    # Load 'extra' from DB if present (JSON string)
    extra_raw = None
    try:
        with db.db_session(app_handle) as sess:
            settings = db.get_provider_settings(sess, "google")
            if settings:
                extra_raw = settings.get("extra")
    except Exception as e:
        print(f"[ModelFactory] Warning: Failed to load google extras: {e}")

    extra = {}
    if isinstance(extra_raw, str) and extra_raw.strip():
        try:
            extra = json.loads(extra_raw)
        except Exception:
            extra = {}

    use_vertex = bool(extra.get("vertexai", False))
    project_id = extra.get("project_id")
    location = extra.get("location")

    if not api_key and not use_vertex:
        raise RuntimeError(
            "Google API key not configured. Set it in Settings (or enable Vertex AI in extras)."
        )

    return Gemini(
        id=model_id,
        api_key=api_key,
        vertexai=use_vertex,
        project_id=project_id,
        location=location,
        include_thoughts=True,
        **kwargs,
    )


def list_supported_providers() -> list[str]:
    """Return list of supported provider names."""
    return [
        "openai",
        "anthropic",
        "groq",
        "ollama",
        "vllm",
        "lmstudio",
        "google",
        "openai_like",
    ]

def _fetch_openai_models(api_key: str, base_url: Optional[str] = None) -> list[Dict[str, str]]:
    """Fetch available models from OpenAI API."""
    try:
        base = base_url or 'https://api.openai.com'
        base = base.rstrip('/')
        
        if base.endswith('/v1'):
            url = f"{base}/models"
        else:
            url = f"{base}/v1/models"
        
        headers = {"Authorization": f"Bearer {api_key}"}
        response = requests.get(url, headers=headers, timeout=5)
        if response.status_code == 200:
            data = response.json()
            models = []
            for model in data.get("data", []):
                model_id = model.get("id", "")
                models.append({"id": model_id, "name": model_id})
            return models
    except Exception as e:
        print(f"[ModelFactory] Failed to fetch OpenAI models: {e}")
    return []


def _fetch_groq_models(api_key: str) -> list[Dict[str, str]]:
    """Fetch available models from Groq API."""
    try:
        url = "https://api.groq.com/openai/v1/models"
        headers = {"Authorization": f"Bearer {api_key}"}
        response = requests.get(url, headers=headers, timeout=5)
        if response.status_code == 200:
            data = response.json()
            models = []
            for model in data.get("data", []):
                model_id = model.get("id", "")
                models.append({"id": model_id, "name": model_id})
            return models
    except Exception as e:
        print(f"[ModelFactory] Failed to fetch Groq models: {e}")
    return []


def _fetch_ollama_models(host: str) -> list[Dict[str, str]]:
    """Fetch available models from Ollama API."""
    try:
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


def _fetch_anthropic_models(api_key: str) -> list[Dict[str, str]]:
    """Fetch available models from Anthropic API."""
    try:
        url = "https://api.anthropic.com/v1/models"
        headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01"
        }
        response = requests.get(url, headers=headers, timeout=5)
        if response.status_code == 200:
            data = response.json()
            models = []
            for model in data.get("data", []):
                model_id = model.get("id", "")
                display_name = model.get("display_name") or model_id
                models.append({"id": model_id, "name": display_name})
            return models
    except Exception as e:
        print(f"[ModelFactory] Failed to fetch Anthropic models: {e}")
    return []


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
    
    if not app_handle:
        return []
    
    all_providers = _check_db_providers(app_handle)
    
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
                api_key = config.get("api_key")
                if api_key:
                    provider_models = _fetch_anthropic_models(api_key)
            
            elif provider == "groq":
                api_key = config.get("api_key")
                if api_key:
                    provider_models = _fetch_groq_models(api_key)
            
            elif provider == "ollama":
                host = config.get("base_url")
                if host:
                    provider_models = _fetch_ollama_models(host)
            
            elif provider == "vllm":
                # vLLM exposes OpenAI-compatible /v1/models
                base_url = config.get("base_url")
                if base_url:
                    api_key = config.get("api_key")
                    provider_models = _fetch_openai_models(api_key or "", base_url)
            
            elif provider == "lmstudio":
                # LM Studio exposes OpenAI-compatible /v1/models
                base_url = config.get("base_url")
                if base_url:
                    api_key = config.get("api_key")
                    provider_models = _fetch_openai_models(api_key or "", base_url)

            elif provider in ("openai_like", "openai-compatible", "openai_compatible"):
                base_url = config.get("base_url")
                api_key = config.get("api_key")
                if base_url:
                    provider_models = _fetch_openai_models(api_key or "", base_url)
            
            elif provider in ("google", "gemini", "google_ai_studio"):
                api_key = config.get("api_key")
                if api_key:
                    provider_models = _fetch_google_models(api_key)
        
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


def _check_db_providers(app_handle: Any) -> Dict[str, Dict[str, Any]]:
    """Check which providers are configured in database."""
    try:
        with db.db_session(app_handle) as sess:
            settings = db.get_all_provider_settings(sess)
            return settings
    except Exception as e:
        print(f"[ModelFactory] Warning: Failed to check DB providers: {e}")
        return {}


def _fetch_google_models(api_key: str) -> list[Dict[str, str]]:
    """Fetch available models from Google AI Studio (Generative Language API)."""
    try:
        # v1beta returns list of models; using query param for API key
        url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            data = response.json()
            models = []
            for m in data.get("models", []):
                raw_name = m.get("name", "")  # e.g., "models/gemini-2.0-flash"
                model_id = raw_name.split("/")[-1] if raw_name else m.get("baseModelId") or ""
                display = m.get("displayName") or model_id
                # Filter only chat-capable Gemini entries if needed
                if model_id:
                    models.append({"id": model_id, "name": display})

            return models
    except Exception as e:
        print(f"[ModelFactory] Failed to fetch Google models: {e}")
    return []
