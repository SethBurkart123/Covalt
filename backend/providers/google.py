"""Google Provider - Gemini models via Google AI Studio or Vertex AI"""

from typing import Any, Dict, List
import httpx
from agno.models.litellm import LiteLLM
from . import get_api_key, get_extra_config, get_credentials
from .. import db

ALIASES = ["gemini", "google_ai_studio"]


def get_google_model(model_id: str, **kwargs: Any) -> LiteLLM:
    """Create a Google Gemini model instance."""
    api_key = get_api_key()
    extra = get_extra_config()
    
    if not api_key and not extra.get("vertexai"):
        raise RuntimeError("Google API key not configured in Settings.")
    
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


async def fetch_models() -> List[Dict[str, Any]]:
    """Fetch available models from Google AI Studio API."""
    api_key = get_api_key()
    
    if not api_key:
        return []
    
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(
                f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
            )
            
            if not response.is_success:
                return []
            
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
                
                if model_info["supports_reasoning"]:
                    _save_reasoning_metadata(model_id)
            
            return models
            
    except Exception as e:
        print(f"[google] Failed to fetch models: {e}")
        return []


async def test_connection() -> tuple[bool, str | None]:
    """
    Test connection to Google AI Studio API.
    
    Returns:
        (success, error_message) tuple
    """
    api_key, _ = get_credentials()
    
    if not api_key:
        return False, "API key not configured"
    
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(
                f"https://generativelanguage.googleapis.com/v1/models?key={api_key}"
            )
            
            if response.is_success:
                return True, None
            elif response.status_code == 401 or response.status_code == 403:
                return False, "Invalid API key"
            else:
                return False, f"API returned status {response.status_code}"
                
    except Exception as e:
        return False, f"Connection failed: {str(e)[:100]}"


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
