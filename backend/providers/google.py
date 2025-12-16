"""Google Provider - Gemini models via Google AI Studio or Vertex AI"""

from typing import Any, Dict, List
import requests
from agno.models.litellm import LiteLLM
from . import get_api_key, get_extra_config
from .. import db

# Alternative names for this provider
ALIASES = ["gemini", "google_ai_studio"]


def get_google_model(model_id: str, **kwargs: Any) -> LiteLLM:
    """Create a Google Gemini model instance."""
    api_key = get_api_key()
    extra = get_extra_config()
    
    if not api_key and not extra.get("vertexai"):
        raise RuntimeError("Google API key not configured in Settings.")
    
    # Configure Vertex AI if enabled
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
    """Fetch available models from Google AI Studio API."""
    api_key = get_api_key()
    
    if not api_key:
        return []
    
    try:
        response = requests.get(
            f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}",
            timeout=5
        )
        
        if not response.ok:
            return []
        
        models = []
        for m in response.json().get("models", []):
            # Extract model ID from full path
            model_id = m.get("name", "").split("/")[-1] or m.get("baseModelId", "")
            
            if not model_id:
                continue
            
            model_info = {
                "id": model_id,
                "name": m.get("displayName", model_id),
                "supports_reasoning": m.get("thinking", False)
            }
            models.append(model_info)
            
            # Store reasoning capability in database
            if model_info["supports_reasoning"]:
                _save_reasoning_metadata(model_id)
        
        return models
        
    except Exception as e:
        print(f"[google] Failed to fetch models: {e}")
        return []


def _save_reasoning_metadata(model_id: str):
    """Save reasoning capability to database for later use."""
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
