from typing import Any, Dict, List
import requests
from agno.models.litellm import LiteLLM
from .. import db


def get_vllm_model(model_id: str, **kwargs: Any) -> LiteLLM:
    """Create vLLM model using LiteLLM."""
    api_key, base_url = _get_credentials()
    
    if not base_url:
        raise RuntimeError("vLLM base URL not configured in Settings.")
    
    return LiteLLM(
        id=f"openai/{model_id}",
        api_key=api_key or "dummy",
        api_base=base_url,
        **kwargs
    )


def fetch_models() -> List[Dict[str, str]]:
    """Fetch available vLLM models."""
    api_key, base_url = _get_credentials()
    if not base_url:
        return []
    
    return _fetch_openai_compatible(base_url, api_key or "")


def _get_credentials():
    """Get credentials from database."""
    with db.db_session() as sess:
        settings = db.get_provider_settings(sess, "vllm")
        return (settings.get("api_key"), settings.get("base_url")) if settings else (None, None)


def _fetch_openai_compatible(base_url: str, api_key: str) -> List[Dict[str, str]]:
    """Fetch models from OpenAI-compatible endpoint."""
    try:
        base = base_url.rstrip("/")
        url = f"{base}/models" if base.endswith("/v1") else f"{base}/v1/models"
        
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        response = requests.get(url, headers=headers, timeout=5)
        
        if response.ok:
            return [{"id": m["id"], "name": m["id"]} for m in response.json().get("data", [])]
    except Exception as e:
        print(f"[vllm] Failed to fetch models: {e}")
    return []

