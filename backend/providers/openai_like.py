"""OpenAI-Like Provider - Custom OpenAI-compatible endpoints"""

from typing import Any, Dict, List
import httpx
from agno.models.litellm import LiteLLM
from . import get_credentials

ALIASES = ["openai_compatible", "openai-compatible", "custom"]


def get_openai_like_model(
    model_id: str,
    provider_options: Dict[str, Any],
) -> LiteLLM:
    api_key, base_url = get_credentials()
    if not base_url:
        raise RuntimeError("Base URL required for OpenAI-compatible provider.")

    return LiteLLM(
        id=f"openai/{model_id}",
        api_key=api_key or "custom",
        api_base=base_url,
        **provider_options,
    )


async def fetch_models() -> List[Dict[str, str]]:
    api_key, base_url = get_credentials()
    if not base_url:
        return []

    return await _fetch_from_openai_endpoint(base_url, api_key or "")


async def _fetch_from_openai_endpoint(
    base_url: str, api_key: str
) -> List[Dict[str, str]]:
    base = base_url.rstrip("/")
    url = f"{base}/models" if (base.endswith("/v1") or base.endswith("/v2")) else f"{base}/v1/models"
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(url, headers=headers)
            if not response.is_success:
                return []

            return [
                {"id": m["id"], "name": m["id"]}
                for m in response.json().get("data", [])
            ]
    except Exception as e:
        print(f"[openai_like] Failed to fetch models: {e}")
        return []


async def test_connection() -> tuple[bool, str | None]:
    api_key, base_url = get_credentials()
    if not api_key:
        return False, "API key not configured"
    if not base_url:
        return False, "Base URL not configured"

    base = base_url.rstrip("/")
    url = f"{base}/models" if base.endswith("/v1") else f"{base}/v1/models"

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(
                url, headers={"Authorization": f"Bearer {api_key}"}
            )

            if response.is_success:
                return True, None
            if response.status_code == 401:
                return False, "Invalid API key"
            if response.status_code == 403:
                return False, "Access forbidden - check API key permissions"
            return False, f"API returned status {response.status_code}"
    except Exception as e:
        return False, f"Connection failed: {str(e)[:100]}"
