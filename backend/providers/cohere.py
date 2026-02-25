"""cohere provider."""

from typing import Any, Dict, List
import httpx
from agno.models.litellm import LiteLLM
from . import get_credentials


DEFAULT_PAGE_SIZE = 1000
MAX_PAGE_COUNT = 5

DEFAULT_BASE_URL = "https://api.cohere.com"
DEFAULT_CHAT_BASE_URLS = {
    "https://api.cohere.com",
    "https://api.cohere.com/v1",
    "https://api.cohere.com/v2",
}


def _normalize_base_url(base_url: str | None) -> str | None:
    return base_url.rstrip("/") if base_url else None


def _should_pass_api_base(base_url: str | None) -> bool:
    base = _normalize_base_url(base_url)
    if not base:
        return False
    return base not in DEFAULT_CHAT_BASE_URLS

def get_cohere_model(model_id: str, provider_options: Dict[str, Any]) -> LiteLLM:
    api_key, base_url = get_credentials()
    if not (base_url or DEFAULT_BASE_URL):
        raise RuntimeError("Base URL not configured in Settings.")

    options = dict(provider_options)
    if _should_pass_api_base(base_url):
        options["api_base"] = _normalize_base_url(base_url)

    return LiteLLM(
        id=f"cohere_chat/{model_id}",
        api_key=api_key or "custom",
        **options,
    )


async def fetch_models() -> List[Dict[str, Any]]:
    api_key, base_url = get_credentials()
    resolved_base_url = base_url or DEFAULT_BASE_URL
    if not resolved_base_url:
        return []

    base = resolved_base_url.rstrip("/")
    if base.endswith("/v1") or base.endswith("/v2"):
        url = f"{base}/models"
    else:
        url = f"{base}/v2/models"

    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    models: list[dict[str, Any]] = []
    next_page_token: str | None = None

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            for _ in range(MAX_PAGE_COUNT):
                params: dict[str, Any] = {"page_size": DEFAULT_PAGE_SIZE}
                if next_page_token:
                    params["page_token"] = next_page_token

                response = await client.get(url, headers=headers, params=params)
                if not response.is_success:
                    return []

                payload = response.json()
                batch = payload.get("models") or payload.get("data") or []
                if not isinstance(batch, list):
                    break

                for model in batch:
                    if not isinstance(model, dict):
                        continue
                    model_id = str(model.get("id") or model.get("name") or "").strip()
                    if not model_id:
                        continue
                    endpoints = model.get("endpoints")
                    if isinstance(endpoints, list) and endpoints and "chat" not in endpoints:
                        continue
                    features = model.get("features")
                    supports_tools: bool | None = None
                    if isinstance(features, list):
                        supports_tools = "tools" in features
                    models.append(
                        {
                            "id": model_id,
                            "name": str(model.get("name") or model_id),
                            **({"supports_tools": supports_tools} if supports_tools is not None else {}),
                            **{k: v for k, v in model.items() if k not in {"id", "name"}},
                        }
                    )

                next_page_token = payload.get("next_page_token")
                if not next_page_token:
                    break
    except Exception as e:
        print(f"[cohere] Failed to fetch models: {e}")
        return []

    return models


def get_model_options(
    model_id: str,
    model_metadata: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    _ = model_id
    supports_tools = True
    if isinstance(model_metadata, dict):
        value = model_metadata.get("supports_tools")
        if isinstance(value, bool):
            supports_tools = value

    return {
        "main": [],
        "advanced": [
            {
                "key": "disable_tools",
                "label": "Disable Tools",
                "type": "boolean",
                "default": not supports_tools,
            }
        ],
    }


async def test_connection() -> tuple[bool, str | None]:
    api_key, base_url = get_credentials()
    if not api_key:
        return False, "API key not configured"

    resolved_base_url = base_url or DEFAULT_BASE_URL
    if not resolved_base_url:
        return False, "Base URL not configured"

    base = resolved_base_url.rstrip("/")
    if base.endswith("/v1") or base.endswith("/v2"):
        url = f"{base}/models"
    else:
        url = f"{base}/v2/models"

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
