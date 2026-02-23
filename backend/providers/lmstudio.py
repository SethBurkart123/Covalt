"""LM Studio Provider - Local models via LM Studio (OpenAI-compatible)"""

from typing import Any, Dict, List
import httpx
from agno.models.litellm import LiteLLM
from . import get_credentials, get_base_url


def get_lmstudio_model(
    model_id: str,
    provider_options: Dict[str, Any],
) -> LiteLLM:
    """Create an LM Studio model instance."""
    api_key, base_url = get_credentials()

    if not base_url:
        raise RuntimeError("LM Studio base URL not configured in Settings.")

    return LiteLLM(
        id=f"openai/{model_id}",
        api_key=api_key or "lm-studio",
        api_base=base_url,
        **provider_options,
    )


async def fetch_models() -> List[Dict[str, str]]:
    """Fetch available models from LM Studio instance."""
    api_key, base_url = get_credentials()
    if not base_url:
        return []

    return await _fetch_from_openai_endpoint(base_url, api_key or "")


async def _fetch_from_openai_endpoint(
    base_url: str, api_key: str
) -> List[Dict[str, str]]:
    """Fetch models from OpenAI-compatible /v1/models endpoint."""
    base = base_url.rstrip("/")
    url = f"{base}/models" if base.endswith("/v1") else f"{base}/v1/models"

    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}

    async with httpx.AsyncClient(timeout=5) as client:
        response = await client.get(url, headers=headers)

        if response.is_success:
            models = response.json().get("data", [])
            return [{"id": m["id"], "name": m["id"]} for m in models]

    return []


async def test_connection() -> tuple[bool, str | None]:
    """Test connection to LM Studio server."""
    base_url = get_base_url()
    if not base_url:
        return False, "Base URL not configured"

    base = base_url.rstrip("/")
    url = f"{base}/models" if base.endswith("/v1") else f"{base}/v1/models"

    async with httpx.AsyncClient(timeout=5) as client:
        response = await client.get(url)

        if response.is_success or response.status_code == 404:
            return True, None

        return False, f"Server returned status {response.status_code}"
