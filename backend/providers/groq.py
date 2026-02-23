"""Groq Provider - Fast inference with Llama and Mixtral models"""

from typing import Any, Dict, List
import httpx
from agno.models.litellm import LiteLLM
from . import get_api_key


def get_groq_model(
    model_id: str,
    provider_options: Dict[str, Any],
) -> LiteLLM:
    """Create a Groq model instance."""
    api_key = get_api_key()

    if not api_key:
        raise RuntimeError("Groq API key not configured in Settings.")

    return LiteLLM(id=f"groq/{model_id}", api_key=api_key, **provider_options)


async def fetch_models() -> List[Dict[str, str]]:
    """Fetch available models from Groq API."""
    api_key = get_api_key()
    if not api_key:
        return []

    async with httpx.AsyncClient(timeout=5) as client:
        response = await client.get(
            "https://api.groq.com/openai/v1/models",
            headers={"Authorization": f"Bearer {api_key}"},
        )

        if response.is_success:
            models = response.json().get("data", [])
            return [{"id": m["id"], "name": m["id"]} for m in models]

    return []


async def test_connection() -> tuple[bool, str | None]:
    """Test connection to Groq API."""
    api_key = get_api_key()
    if not api_key:
        return False, "API key not configured"

    async with httpx.AsyncClient(timeout=5) as client:
        response = await client.get(
            "https://api.groq.com/openai/v1/models",
            headers={"Authorization": f"Bearer {api_key}"},
        )

        if response.is_success:
            return True, None
        if response.status_code == 401:
            return False, "Invalid API key"
        if response.status_code == 403:
            return False, "Access forbidden - check API key permissions"

        return False, f"API returned status {response.status_code}"
