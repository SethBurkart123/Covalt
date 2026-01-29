"""Anthropic Provider - Claude models via Anthropic API"""

from typing import Any, Dict, List
import httpx
from agno.models.litellm import LiteLLM
from . import get_api_key, get_credentials

ALIASES = ["claude"]


def get_anthropic_model(model_id: str, **kwargs: Any) -> LiteLLM:
    """Create an Anthropic Claude model instance."""
    api_key = get_api_key()

    if not api_key:
        raise RuntimeError("Anthropic API key not configured in Settings.")

    return LiteLLM(id=f"anthropic/{model_id}", api_key=api_key, **kwargs)


async def fetch_models() -> List[Dict[str, str]]:
    """Fetch available models from Anthropic API."""
    api_key = get_api_key()
    if not api_key:
        return []

    async with httpx.AsyncClient(timeout=5) as client:
        response = await client.get(
            "https://api.anthropic.com/v1/models",
            headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
        )

        if response.is_success:
            models = response.json().get("data", [])
            return [
                {"id": m["id"], "name": m.get("display_name", m["id"])} for m in models
            ]

    return []


async def test_connection() -> tuple[bool, str | None]:
    """Test connection to Anthropic API."""
    api_key = get_api_key()
    if not api_key:
        return False, "API key not configured"

    async with httpx.AsyncClient(timeout=5) as client:
        response = await client.get(
            "https://api.anthropic.com/v1/models",
            headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
        )

        if response.is_success or response.status_code == 400:
            return True, None
        if response.status_code == 401:
            return False, "Invalid API key"
        if response.status_code == 403:
            return False, "Access forbidden - check API key permissions"

        return False, f"API returned status {response.status_code}"
