"""Groq Provider - Fast inference with Llama and Mixtral models"""

from typing import Any, Dict, List
import requests
from agno.models.litellm import LiteLLM
from . import get_api_key


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
