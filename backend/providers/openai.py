from typing import Any, Dict, List
import requests
from agno.models.litellm import LiteLLM
from .. import db


def get_openai_model(model_id: str, **kwargs: Any) -> LiteLLM:
    """Create OpenAI model using LiteLLM."""
    api_key, base_url = _get_credentials()
    
    if not api_key:
        raise RuntimeError("OpenAI API key not configured in Settings.")
    
    return LiteLLM(
        id=f"openai/{model_id}",
        api_key=api_key,
        api_base=base_url,
        **kwargs
    )


def fetch_models() -> List[Dict[str, str]]:
    """Fetch available OpenAI models."""
    api_key, base_url = _get_credentials()
    if not api_key:
        return []
    
    url = _build_models_url(base_url or "https://api.openai.com")
    return _fetch_openai_compatible(url, api_key)


def _get_credentials():
    """Get API key and base URL from database."""
    with db.db_session() as sess:
        settings = db.get_provider_settings(sess, "openai")
        return (settings.get("api_key"), settings.get("base_url")) if settings else (None, None)


def _build_models_url(base: str) -> str:
    """Build /v1/models URL from base."""
    base = base.rstrip("/")
    return f"{base}/models" if base.endswith("/v1") else f"{base}/v1/models"


def _fetch_openai_compatible(url: str, api_key: str) -> List[Dict[str, str]]:
    """Fetch models from OpenAI-compatible endpoint."""
    try:
        response = requests.get(
            url, 
            headers={"Authorization": f"Bearer {api_key}"}, 
            timeout=5
        )
        if response.ok:
            return [{"id": m["id"], "name": m["id"]} for m in response.json().get("data", [])]
    except Exception as e:
        print(f"[openai] Failed to fetch models: {e}")
    return []

