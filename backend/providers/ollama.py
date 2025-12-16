"""Ollama Provider - Local models running on Ollama"""

from typing import Any, Dict, List
import requests
from agno.models.litellm import LiteLLM
from . import get_base_url


def get_ollama_model(model_id: str, **kwargs: Any) -> LiteLLM:
    """Create an Ollama model instance."""
    host = get_base_url()
    
    if not host:
        raise RuntimeError("Ollama host not configured in Settings.")
    
    return LiteLLM(
        id=f"ollama/{model_id}",
        api_base=host,
        **kwargs
    )


def fetch_models() -> List[Dict[str, str]]:
    """Fetch available models from local Ollama instance."""
    host = get_base_url()
    
    if not host:
        return []
    
    try:
        response = requests.get(f"{host}/api/tags", timeout=5)
        
        if response.ok:
            models = response.json().get("models", [])
            return [
                {
                    "id": m["name"],
                    "name": m["name"].split(":")[0].title()  # Clean display name
                }
                for m in models
                if m.get("name")
            ]
            
    except Exception as e:
        print(f"[ollama] Failed to fetch models: {e}")
    
    return []


def test_connection() -> tuple[bool, str | None]:
    """
    Test connection to Ollama server.
    
    Returns:
        (success, error_message) tuple
    """
    host = get_base_url()
    
    if not host:
        return False, "Host URL not configured"
    
    try:
        response = requests.get(f"{host}/api/tags", timeout=5)
        
        if response.ok:
            return True, None
        else:
            return False, f"Server returned status {response.status_code}"
            
    except requests.exceptions.Timeout:
        return False, "Connection timeout - server not responding"
    except requests.exceptions.ConnectionError:
        return False, "Cannot connect to server"
    except Exception as e:
        return False, f"Connection failed: {str(e)[:100]}"
