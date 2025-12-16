from typing import Any, Dict, List
import requests
from agno.models.litellm import LiteLLM
from .. import db


def get_groq_model(model_id: str, **kwargs: Any) -> LiteLLM:
    """Create Groq model using LiteLLM."""
    api_key = _get_api_key()
    
    if not api_key:
        raise RuntimeError("Groq API key not configured in Settings.")
    
    return LiteLLM(
        id=f"groq/{model_id}",
        api_key=api_key,
        **kwargs
    )


def fetch_models() -> List[Dict[str, str]]:
    """Fetch available Groq models."""
    api_key = _get_api_key()
    if not api_key:
        return []
    
    try:
        response = requests.get(
            "https://api.groq.com/openai/v1/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=5
        )
        if response.ok:
            return [{"id": m["id"], "name": m["id"]} for m in response.json().get("data", [])]
    except Exception as e:
        print(f"[groq] Failed to fetch models: {e}")
    return []


def _get_api_key():
    """Get API key from database."""
    with db.db_session() as sess:
        settings = db.get_provider_settings(sess, "groq")
        return settings.get("api_key") if settings else None

