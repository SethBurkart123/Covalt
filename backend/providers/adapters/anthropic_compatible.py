"""Anthropic-compatible provider adapter.

Generates provider functions for endpoints that expose Anthropic-style
model and chat APIs using x-api-key authentication.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import httpx
from agno.models.litellm import LiteLLM

from .. import get_credentials
from . import register_adapter


def _models_url(base_url: str) -> str:
    base = base_url.rstrip("/")
    return f"{base}/models" if base.endswith("/v1") else f"{base}/v1/models"


def create_provider(
    provider_id: str,
    base_url: Optional[str] = None,
    anthropic_version: str = "2023-06-01",
    **_kwargs: Any,
) -> Dict[str, Any]:
    """Build a provider entry for Anthropic-compatible endpoints."""

    def _resolve_credentials() -> tuple[Optional[str], Optional[str], Optional[str]]:
        api_key, custom_base_url = get_credentials(provider_name=provider_id)
        resolved = custom_base_url or base_url
        return api_key, custom_base_url, resolved

    def get_model(model_id: str, provider_options: Dict[str, Any]) -> LiteLLM:
        api_key, _, resolved = _resolve_credentials()
        if not api_key:
            raise RuntimeError("API key not configured in Settings.")

        options = dict(provider_options)
        if resolved:
            options.setdefault("api_base", resolved)

        return LiteLLM(
            id=f"anthropic/{model_id}",
            api_key=api_key,
            **options,
        )

    async def fetch_models() -> List[Dict[str, Any]]:
        api_key, _, resolved = _resolve_credentials()
        if not api_key or not resolved:
            return []

        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(
                _models_url(resolved),
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": anthropic_version,
                },
            )
            if not response.is_success:
                return []

            models = response.json().get("data", [])
            return [
                {
                    "id": model.get("id"),
                    "name": model.get("display_name") or model.get("id"),
                }
                for model in models
                if model.get("id")
            ]

    async def test_connection() -> tuple[bool, str | None]:
        api_key, _, resolved = _resolve_credentials()
        if not api_key:
            return False, "API key not configured"
        if not resolved:
            return False, "Base URL not configured"

        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(
                _models_url(resolved),
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": anthropic_version,
                },
            )

            if response.is_success or response.status_code == 400:
                return True, None
            if response.status_code == 401:
                return False, "Invalid API key"
            if response.status_code == 403:
                return False, "Access forbidden - check API key permissions"

            return False, f"API returned status {response.status_code}"

    return {
        "get_model": get_model,
        "fetch_models": fetch_models,
        "test_connection": test_connection,
    }


register_adapter("anthropic_compatible", create_provider)
