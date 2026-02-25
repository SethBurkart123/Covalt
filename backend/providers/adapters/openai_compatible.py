"""OpenAI-compatible provider adapter.

Generates the provider functions (get_model, fetch_models, test_connection)
for any provider that speaks the standard OpenAI chat/completions protocol.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import httpx
from agno.models.litellm import LiteLLM

from .. import get_credentials
from ..openai_like import _fetch_from_openai_endpoint
from . import register_adapter


def create_provider(
    provider_id: str,
    base_url: Optional[str] = None,
    **_kwargs: Any,
) -> Dict[str, Any]:
    """Build a full provider entry for an OpenAI-compatible endpoint.

    *provider_id* is used for credential lookup (bypasses stack inspection).
    *base_url* is the default API base; users can override via settings.
    """

    def get_model(model_id: str, provider_options: Dict[str, Any]) -> LiteLLM:
        api_key, custom_base_url = get_credentials(provider_name=provider_id)
        resolved = custom_base_url or base_url
        if not resolved:
            raise RuntimeError("Base URL not configured in Settings.")
        return LiteLLM(
            id=f"openai/{model_id}",
            api_key=api_key or "custom",
            api_base=resolved,
            **provider_options,
        )

    async def fetch_models() -> List[Dict[str, Any]]:
        api_key, custom_base_url = get_credentials(provider_name=provider_id)
        resolved = custom_base_url or base_url
        if not resolved:
            return []
        return await _fetch_from_openai_endpoint(resolved, api_key or "")

    async def test_connection() -> tuple[bool, str | None]:
        api_key, custom_base_url = get_credentials(provider_name=provider_id)
        if not api_key:
            return False, "API key not configured"
        resolved = custom_base_url or base_url
        if not resolved:
            return False, "Base URL not configured"
        base = resolved.rstrip("/")
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

    return {
        "get_model": get_model,
        "fetch_models": fetch_models,
        "test_connection": test_connection,
    }


register_adapter("openai_compatible", create_provider)
