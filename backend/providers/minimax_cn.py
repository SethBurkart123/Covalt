"""minimax-cn provider."""

from typing import Any, Dict, List
import httpx
from agno.models.litellm import LiteLLM
from . import get_credentials

DEFAULT_BASE_URL = "https://api.minimaxi.com/anthropic/v1"

def get_minimax_cn_model(model_id: str, provider_options: Dict[str, Any]) -> LiteLLM:
    api_key, base_url = get_credentials()
    if not api_key:
        raise RuntimeError("API key not configured in Settings.")

    resolved_base_url = base_url or DEFAULT_BASE_URL

    return LiteLLM(
        id=f"anthropic/{model_id}",
        api_key=api_key,
        api_base=resolved_base_url,
        **provider_options,
    )


async def fetch_models() -> List[Dict[str, Any]]:
    api_key, base_url = get_credentials()
    if not api_key:
        return []

    resolved_base_url = base_url or DEFAULT_BASE_URL
    base = resolved_base_url.rstrip("/")
    url = f"{base}/models" if base.endswith("/v1") else f"{base}/v1/models"

    async with httpx.AsyncClient(timeout=5) as client:
        response = await client.get(
            url,
            headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
        )

        if response.is_success:
            models = response.json().get("data", [])
            return [
                {
                    "id": m["id"],
                    "name": m.get("display_name", m["id"]),
                }
                for m in models
            ]

    return []


async def test_connection() -> tuple[bool, str | None]:
    api_key, base_url = get_credentials()
    if not api_key:
        return False, "API key not configured"

    resolved_base_url = base_url or DEFAULT_BASE_URL
    base = resolved_base_url.rstrip("/")
    url = f"{base}/models" if base.endswith("/v1") else f"{base}/v1/models"

    async with httpx.AsyncClient(timeout=5) as client:
        response = await client.get(
            url,
            headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
        )

        if response.is_success or response.status_code == 400:
            return True, None
        if response.status_code == 401:
            return False, "Invalid API key"
        if response.status_code == 403:
            return False, "Access forbidden - check API key permissions"

        return False, f"API returned status {response.status_code}"
