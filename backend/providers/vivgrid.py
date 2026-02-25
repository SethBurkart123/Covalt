"""vivgrid provider."""

from typing import Any, Dict, List
import httpx
from agno.models.litellm import LiteLLM
from . import get_credentials
from .openai_like import _fetch_from_openai_endpoint

DEFAULT_BASE_URL = "https://api.vivgrid.com/v1"

def get_vivgrid_model(model_id: str, provider_options: Dict[str, Any]) -> LiteLLM:
    api_key, base_url = get_credentials()
    resolved_base_url = base_url or DEFAULT_BASE_URL
    if not resolved_base_url:
        raise RuntimeError("Base URL not configured in Settings.")

    return LiteLLM(
        id=f"openai/{model_id}",
        api_key=api_key or "custom",
        api_base=resolved_base_url,
        **provider_options,
    )


async def fetch_models() -> List[Dict[str, Any]]:
    api_key, base_url = get_credentials()
    resolved_base_url = base_url or DEFAULT_BASE_URL
    if not resolved_base_url:
        return []

    return await _fetch_from_openai_endpoint(resolved_base_url, api_key or "")


async def test_connection() -> tuple[bool, str | None]:
    api_key, base_url = get_credentials()
    if not api_key:
        return False, "API key not configured"

    resolved_base_url = base_url or DEFAULT_BASE_URL
    if not resolved_base_url:
        return False, "Base URL not configured"

    base = resolved_base_url.rstrip("/")
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
