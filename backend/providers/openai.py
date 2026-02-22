"""OpenAI Provider - GPT models via OpenAI API"""

from typing import Any, Dict, List
import httpx
from agno.models.litellm import LiteLLM
from . import get_credentials


def get_openai_model(model_id: str, **kwargs: Any) -> LiteLLM:
    api_key, base_url = get_credentials()
    if not api_key:
        raise RuntimeError("OpenAI API key not configured in Settings.")

    return LiteLLM(
        id=f"openai/{model_id}", api_key=api_key, api_base=base_url, **kwargs
    )


async def fetch_models() -> List[Dict[str, str]]:
    api_key, base_url = get_credentials()
    if not api_key:
        return []

    base = (base_url or "https://api.openai.com").rstrip("/")
    url = f"{base}/models" if base.endswith("/v1") else f"{base}/v1/models"

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(
                url, headers={"Authorization": f"Bearer {api_key}"}
            )
            if not response.is_success:
                return []

            return [
                {"id": m["id"], "name": m["id"]}
                for m in response.json().get("data", [])
            ]
    except Exception as e:
        print(f"[openai] Failed to fetch models: {e}")
        return []


def get_model_options(
    model_id: str,
    model_metadata: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    _ = model_id, model_metadata
    return {
        "main": [],
        "advanced": [
            {
                "key": "temperature",
                "label": "Temperature",
                "type": "slider",
                "min": 0,
                "max": 2,
                "step": 0.1,
                "default": 1,
            },
            {
                "key": "top_p",
                "label": "Top P",
                "type": "slider",
                "min": 0,
                "max": 1,
                "step": 0.05,
                "default": 1,
            },
            {
                "key": "max_tokens",
                "label": "Max Tokens",
                "type": "number",
                "min": 1,
                "max": 128000,
                "default": 4096,
            },
        ],
    }


def map_model_options(model_id: str, options: Dict[str, Any]) -> Dict[str, Any]:
    _ = model_id
    kwargs: Dict[str, Any] = {}
    for key in ("temperature", "top_p", "max_tokens"):
        if key in options:
            kwargs[key] = options[key]
    return kwargs


async def test_connection() -> tuple[bool, str | None]:
    api_key, base_url = get_credentials()
    if not api_key:
        return False, "API key not configured"

    base = (base_url or "https://api.openai.com").rstrip("/")
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
