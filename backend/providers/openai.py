"""OpenAI Provider - GPT models via OpenAI API"""

from typing import Any, Dict, List
import httpx
from agno.models.litellm import LiteLLM
from . import get_credentials


def get_openai_model(model_id: str, **kwargs: Any) -> LiteLLM:
    """Create an OpenAI model instance."""
    api_key, base_url = get_credentials()
    
    if not api_key:
        raise RuntimeError("OpenAI API key not configured in Settings.")
    
    return LiteLLM(
        id=f"openai/{model_id}",
        api_key=api_key,
        api_base=base_url,
        **kwargs
    )


async def fetch_models() -> List[Dict[str, str]]:
    """Fetch available models from OpenAI API."""
    api_key, base_url = get_credentials()
    
    if not api_key:
        return []
    
    base = (base_url or "https://api.openai.com").rstrip("/")
    url = f"{base}/models" if base.endswith("/v1") else f"{base}/v1/models"
    
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(
                url,
                headers={"Authorization": f"Bearer {api_key}"}
            )
            
            if response.is_success:
                models = response.json().get("data", [])
                return [{"id": m["id"], "name": m["id"]} for m in models]
                
    except Exception as e:
        print(f"[openai] Failed to fetch models: {e}")
    
    return []


async def test_connection() -> tuple[bool, str | None]:
    """
    Test connection to OpenAI API.
    
    Returns:
        (success, error_message) tuple
    """
    api_key, base_url = get_credentials()
    
    if not api_key:
        return False, "API key not configured"
    
    try:
        base = (base_url or "https://api.openai.com").rstrip("/")
        url = f"{base}/models" if base.endswith("/v1") else f"{base}/v1/models"
        
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(
                url,
                headers={"Authorization": f"Bearer {api_key}"}
            )
            
            if response.is_success:
                return True, None
            elif response.status_code == 401:
                return False, "Invalid API key"
            elif response.status_code == 403:
                return False, "Access forbidden - check API key permissions"
            else:
                return False, f"API returned status {response.status_code}"
                
    except Exception as e:
        return False, f"Connection failed: {str(e)[:100]}"
