"""Groq Provider - Fast inference with Llama and Mixtral models"""

from typing import Any, Dict, List
import requests
from agno.models.litellm import LiteLLM
from . import get_api_key, get_credentials


def get_groq_model(model_id: str, **kwargs: Any) -> LiteLLM:
    """Create a Groq model instance."""
    api_key = get_api_key()
    
    if not api_key:
        raise RuntimeError("Groq API key not configured in Settings.")
    
    return LiteLLM(
        id=f"groq/{model_id}",
        api_key=api_key,
        **kwargs
    )


def fetch_models() -> List[Dict[str, str]]:
    """Fetch available models from Groq API."""
    api_key = get_api_key()
    
    if not api_key:
        return []
    
    try:
        response = requests.get(
            "https://api.groq.com/openai/v1/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=5
        )
        
        if response.ok:
            models = response.json().get("data", [])
            return [{"id": m["id"], "name": m["id"]} for m in models]
            
    except Exception as e:
        print(f"[groq] Failed to fetch models: {e}")
    
    return []


def test_connection() -> tuple[bool, str | None]:
    """
    Test connection to Groq API.
    
    Returns:
        (success, error_message) tuple
    """
    api_key, _ = get_credentials()
    
    if not api_key:
        return False, "API key not configured"
    
    try:
        response = requests.get(
            "https://api.groq.com/openai/v1/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=5
        )
        
        if response.ok:
            return True, None
        elif response.status_code == 401:
            return False, "Invalid API key"
        elif response.status_code == 403:
            return False, "Access forbidden - check API key permissions"
        else:
            return False, f"API returned status {response.status_code}"
            
    except requests.exceptions.Timeout:
        return False, "Request timeout"
    except requests.exceptions.ConnectionError:
        return False, "Cannot reach API server"
    except Exception as e:
        return False, f"Connection failed: {str(e)[:100]}"
