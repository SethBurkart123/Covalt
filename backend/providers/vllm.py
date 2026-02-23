"""vLLM Provider - Self-hosted models via vLLM (OpenAI-compatible)"""

from typing import Any, Dict, List
import httpx
from agno.models.litellm import LiteLLM
from . import get_credentials, get_base_url


def get_vllm_model(
    model_id: str,
    provider_options: Dict[str, Any],
) -> LiteLLM:
    api_key, base_url = get_credentials()
    if not base_url:
        raise RuntimeError("vLLM base URL not configured in Settings.")

    return LiteLLM(
        id=f"openai/{model_id}",
        api_key=api_key or "dummy",
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
    url = f"{base}/models" if base.endswith("/v1") else f"{base}/v1/models"
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
        print(f"[vllm] Failed to fetch models: {e}")
        return []


async def test_connection() -> tuple[bool, str | None]:
    host = get_base_url()
    if not host:
        return False, "Base URL not configured"

    base = host.rstrip("/")
    url = f"{base}/models" if base.endswith("/v1") else f"{base}/v1/models"

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(url)
            return (
                (True, None)
                if response.is_success or response.status_code == 404
                else (False, f"Server returned status {response.status_code}")
            )
    except Exception as e:
        return False, f"Connection failed: {str(e)[:100]}"
