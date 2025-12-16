"""Anthropic Provider - Claude models via Anthropic API"""

from typing import Any, Dict, List
import requests
from agno.models.litellm import LiteLLM
from . import get_api_key, get_credentials

# Alternative names for this provider
ALIASES = ["claude"]


def get_anthropic_model(model_id: str, **kwargs: Any) -> LiteLLM:
    """Create an Anthropic Claude model instance."""
    api_key = get_api_key()
    
    if not api_key:
        raise RuntimeError("Anthropic API key not configured in Settings.")
    
    return LiteLLM(
        id=f"anthropic/{model_id}",
        api_key=api_key,
        **kwargs
    )


def fetch_models() -> List[Dict[str, str]]:
    """Fetch available models from Anthropic API."""
    api_key = get_api_key()
    
    if not api_key:
        return []
    
    try:
        response = requests.get(
            "https://api.anthropic.com/v1/models",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01"
            },
            timeout=5
        )
        
        if response.ok:
            models = response.json().get("data", [])
            return [
                {
                    "id": m["id"],
                    "name": m.get("display_name", m["id"])
                }
                for m in models
            ]
            
    except Exception as e:
        print(f"[anthropic] Failed to fetch models: {e}")
    
    return []


def test_connection() -> tuple[bool, str | None]:
    """
    Test connection to Anthropic API.
    
    Returns:
        (success, error_message) tuple
    """
    api_key, _ = get_credentials()
    
    if not api_key:
        return False, "API key not configured"
    
    try:
        response = requests.get(
            "https://api.anthropic.com/v1/models",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01"
            },
            timeout=5
        )
        
        # Even 400 is OK
        if response.ok or response.status_code == 400:
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
