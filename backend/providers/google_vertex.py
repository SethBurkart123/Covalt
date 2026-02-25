"""google-vertex provider."""

from typing import Any, Dict, List
import httpx
from agno.models.litellm import LiteLLM
from . import get_api_key

def get_google_vertex_model(model_id: str, provider_options: Dict[str, Any]) -> LiteLLM:
    api_key = get_api_key()
    if not api_key:
        raise RuntimeError("Google API key not configured in Settings.")

    return LiteLLM(id=f"gemini/{model_id}", api_key=api_key, **provider_options)


async def fetch_models() -> List[Dict[str, Any]]:
    api_key = get_api_key()
    if not api_key:
        return []

    async with httpx.AsyncClient(timeout=5) as client:
        response = await client.get(
            f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
        )

        if not response.is_success:
            return []

        models = []
        for m in response.json().get("models", []):
            model_id = m.get("name", "").split("/")[-1] or m.get("baseModelId", "")
            if model_id:
                models.append({"id": model_id, "name": m.get("displayName", model_id)})
        return models


async def test_connection() -> tuple[bool, str | None]:
    api_key = get_api_key()
    if not api_key:
        return False, "API key not configured"

    async with httpx.AsyncClient(timeout=5) as client:
        response = await client.get(
            f"https://generativelanguage.googleapis.com/v1/models?key={api_key}"
        )

        if response.is_success:
            return True, None
        if response.status_code in (401, 403):
            return False, "Invalid API key"

        return False, f"API returned status {response.status_code}"
