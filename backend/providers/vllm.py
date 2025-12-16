"""vLLM Provider - Self-hosted models via vLLM (OpenAI-compatible)"""

from typing import Any, Dict, List
import requests
from agno.models.litellm import LiteLLM
from . import get_credentials, get_base_url


def get_vllm_model(model_id: str, **kwargs: Any) -> LiteLLM:
    """Create a vLLM model instance."""
    api_key, base_url = get_credentials()
    
    if not base_url:
        raise RuntimeError("vLLM base URL not configured in Settings.")
    
    return LiteLLM(
        id=f"openai/{model_id}",  # vLLM is OpenAI-compatible
        api_key=api_key or "dummy",
        api_base=base_url,
        **kwargs
    )


def fetch_models() -> List[Dict[str, str]]:
    """Fetch available models from vLLM instance."""
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
        print(f"[vllm] Failed to fetch models: {e}")
    
    return []


def test_connection() -> tuple[bool, str | None]:
    """
    Test connection to vLLM server.
    
    Returns:
        (success, error_message) tuple
    """
    host = get_base_url()
    
    if not host:
        return False, "Base URL not configured"
    
    try:
        base = host.rstrip("/")
        url = f"{base}/models" if base.endswith("/v1") else f"{base}/v1/models"
        
        response = requests.get(url, timeout=5)
        
        # Both 200 and 404 indicate server is running
        if response.ok or response.status_code == 404:
            return True, None
        else:
            return False, f"Server returned status {response.status_code}"
            
    except requests.exceptions.Timeout:
        return False, "Connection timeout - server not responding"
    except requests.exceptions.ConnectionError:
        return False, "Cannot connect to server"
    except Exception as e:
        return False, f"Connection failed: {str(e)[:100]}"
