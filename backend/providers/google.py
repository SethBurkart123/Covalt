from typing import Any, Dict, List
import json
import requests
from agno.models.litellm import LiteLLM
from .. import db


def get_google_model(model_id: str, **kwargs: Any) -> LiteLLM:
    """Create Google Gemini model using LiteLLM."""
    api_key = _get_api_key()
    extra = _get_extra_config()
    
    if not api_key and not extra.get("vertexai"):
        raise RuntimeError("Google API key not configured in Settings.")
    
    # Build Vertex AI params if needed
    request_params = None
    if extra.get("vertexai"):
        request_params = {
            "vertex_project": extra.get("project_id"),
            "vertex_location": extra.get("location")
        }
    
    return LiteLLM(
        id=f"gemini/{model_id}",
        api_key=api_key,
        request_params=request_params,
        **kwargs
    )


def fetch_models() -> List[Dict[str, Any]]:
    """Fetch available Google Gemini models."""
    api_key = _get_api_key()
    if not api_key:
        return []
    
    try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
        response = requests.get(url, timeout=5)
        
        if response.ok:
            models = []
            for m in response.json().get("models", []):
                model_id = m.get("name", "").split("/")[-1] or m.get("baseModelId", "")
                if not model_id:
                    continue
                
                model_info = {
                    "id": model_id,
                    "name": m.get("displayName", model_id),
                    "supports_reasoning": m.get("thinking", False)
                }
                models.append(model_info)
                
                # Save reasoning capability to DB
                if model_info["supports_reasoning"]:
                    _save_reasoning_capability(model_id)
            
            return models
    except Exception as e:
        print(f"[google] Failed to fetch models: {e}")
    return []


def _get_api_key():
    """Get API key from database."""
    with db.db_session() as sess:
        settings = db.get_provider_settings(sess, "google")
        return settings.get("api_key") if settings else None


def _get_extra_config():
    """Get extra config from database."""
    with db.db_session() as sess:
        settings = db.get_provider_settings(sess, "google")
        if not settings or not settings.get("extra"):
            return {}
        
        extra = settings.get("extra")
        return json.loads(extra) if isinstance(extra, str) else extra


def _save_reasoning_capability(model_id: str):
    """Save reasoning capability to database."""
    try:
        with db.db_session() as sess:
            db.upsert_model_settings(
                sess,
                provider="google",
                model_id=model_id,
                reasoning={"supports": True, "isUserOverride": False}
            )
    except Exception as e:
        print(f"[google] Failed to save reasoning metadata: {e}")

