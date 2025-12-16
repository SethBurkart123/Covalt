from typing import Any, Dict, List
import requests
from agno.models.litellm import LiteLLM
from .. import db


def get_anthropic_model(model_id: str, **kwargs: Any) -> LiteLLM:
    """Create Anthropic Claude model using LiteLLM."""
    api_key = _get_api_key()
    
    if not api_key:
        raise RuntimeError("Anthropic API key not configured in Settings.")
    
    return LiteLLM(
        id=f"anthropic/{model_id}",
        api_key=api_key,
        **kwargs
    )


def fetch_models() -> List[Dict[str, str]]:
    """Fetch available Anthropic models."""
    api_key = _get_api_key()
    if not api_key:
        return []
    
    try:
        response = requests.get(
            "https://api.anthropic.com/v1/models",
            headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
            timeout=5
        )
        if response.ok:
            return [
                {"id": m["id"], "name": m.get("display_name", m["id"])}
                for m in response.json().get("data", [])
            ]
    except Exception as e:
        print(f"[anthropic] Failed to fetch models: {e}")
    return []


def _get_api_key():
    """Get API key from database."""
    with db.db_session() as sess:
        settings = db.get_provider_settings(sess, "anthropic")
        return settings.get("api_key") if settings else None

