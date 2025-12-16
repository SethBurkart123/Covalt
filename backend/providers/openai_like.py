"""OpenAI-Like Provider - Custom OpenAI-compatible endpoints"""

from typing import Any, Dict, List
import requests
from agno.models.litellm import LiteLLM
from . import get_credentials

# Alternative names for this provider
ALIASES = ["openai_compatible", "openai-compatible", "custom"]


def get_openai_like_model(model_id: str, **kwargs: Any) -> LiteLLM:
    """Create a model instance for custom OpenAI-compatible endpoint."""
    api_key, base_url = get_credentials()
    
    if not base_url:
        raise RuntimeError("Base URL required for OpenAI-compatible provider.")
    
    return LiteLLM(
        id=f"openai/{model_id}",
        api_key=api_key or "custom",
        api_base=base_url,
        **kwargs
    )


def fetch_models() -> List[Dict[str, str]]:
    """Fetch available models from custom endpoint."""
    api_key, base_url = get_credentials()
    
    if not base_url:
        return []
    
    return _fetch_from_openai_endpoint(base_url, api_key or "")


def _fetch_from_openai_endpoint(base_url: str, api_key: str) -> List[Dict[str, str]]:
    """Fetch models from OpenAI-compatible /v1/models endpoint."""
    try:
        # Build URL
        base = base_url.rstrip("/")
        url = f"{base}/models" if base.endswith("/v1") else f"{base}/v1/models"
        
        # Build headers
        headers = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        
        # Fetch models
        response = requests.get(url, headers=headers, timeout=5)
        
        if response.ok:
            models = response.json().get("data", [])
            return [{"id": m["id"], "name": m["id"]} for m in models]
            
    except Exception as e:
        print(f"[openai_like] Failed to fetch models: {e}")
    
    return []


def test_connection() -> tuple[bool, str | None]:
    """
    Test connection to OpenAI-compatible API.
    
    Returns:
        (success, error_message) tuple
    """
    api_key, base_url = get_credentials()
    
    if not api_key:
        return False, "API key not configured"
    
    if not base_url:
        return False, "Base URL not configured"
    
    try:
        base = base_url.rstrip("/")
        url = f"{base}/models" if base.endswith("/v1") else f"{base}/v1/models"
        
        response = requests.get(
            url,
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
