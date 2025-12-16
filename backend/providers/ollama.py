from typing import Any, Dict, List
import requests
from agno.models.litellm import LiteLLM
from .. import db


def get_ollama_model(model_id: str, **kwargs: Any) -> LiteLLM:
    """Create Ollama model using LiteLLM."""
    host = _get_host()
    
    if not host:
        raise RuntimeError("Ollama host not configured in Settings.")
    
    return LiteLLM(
        id=f"ollama/{model_id}",
        api_base=host,
        **kwargs
    )


def fetch_models() -> List[Dict[str, str]]:
    """Fetch available Ollama models."""
    host = _get_host()
    if not host:
        return []
    
    try:
        response = requests.get(f"{host}/api/tags", timeout=5)
        if response.ok:
            return [
                {"id": m["name"], "name": m["name"].split(":")[0].title()}
                for m in response.json().get("models", [])
                if m.get("name")
            ]
    except Exception as e:
        print(f"[ollama] Failed to fetch models: {e}")
    return []


def _get_host():
    """Get host from database."""
    with db.db_session() as sess:
        settings = db.get_provider_settings(sess, "ollama")
        return settings.get("base_url") if settings else None

