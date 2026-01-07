"""OpenRouter Provider - Access to multiple AI models via OpenRouter"""

from typing import Any, Dict, List
import httpx
from agno.models.litellm import LiteLLM
from . import get_api_key


def get_openrouter_model(model_id: str, **kwargs: Any) -> LiteLLM:
    """Create an OpenRouter model instance."""
    api_key = get_api_key()
    
    if not api_key:
        raise RuntimeError("OpenRouter API key not configured in Settings.")
    
    return LiteLLM(
        id=f"openrouter/{model_id}",
        api_key=api_key,
        api_base="https://openrouter.ai/api/v1",
        **kwargs
    )


async def fetch_models() -> List[Dict[str, str]]:
    """Fetch available models from OpenRouter API."""
    api_key = get_api_key()
    
    if not api_key:
        return []
    
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                "https://openrouter.ai/api/v1/models",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "HTTP-Referer": "https://github.com/agno-ai/agno",  # Optional: for analytics
                }
            )
            
            if response.is_success:
                models = response.json().get("data", [])
                return [{"id": m["id"], "name": m.get("name", m["id"])} for m in models]
                
    except Exception as e:
        print(f"[openrouter] Failed to fetch models: {e}")
    
    return []


async def test_connection() -> tuple[bool, str | None]:
    """
    Test connection to OpenRouter API.
    
    Returns:
        (success, error_message) tuple
    """
    api_key = get_api_key()
    
    if not api_key:
        return False, "API key not configured"
    
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(
                "https://openrouter.ai/api/v1/models",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "HTTP-Referer": "https://github.com/agno-ai/agno",
                }
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

