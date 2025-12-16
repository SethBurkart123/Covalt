"""Anthropic Provider - Claude models via Anthropic API"""

from typing import Any, Dict, List
import requests
from agno.models.litellm import LiteLLM
from . import get_api_key

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
