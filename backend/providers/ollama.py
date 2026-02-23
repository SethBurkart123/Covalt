"""Ollama Provider - Local models running on Ollama"""

from typing import Any, Dict, List
import httpx
from agno.models.litellm import LiteLLM
from . import get_base_url


def get_ollama_model(model_id: str, **kwargs: Any) -> LiteLLM:
    host = get_base_url()
    if not host:
        raise RuntimeError("Ollama host not configured in Settings.")

    return LiteLLM(id=f"ollama/{model_id}", api_base=host, **kwargs)


async def fetch_models() -> List[Dict[str, str]]:
    host = get_base_url()
    if not host:
        return []

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(f"{host}/api/tags")
            if not response.is_success:
                return []

            return [
                {"id": m["name"], "name": m["name"].split(":")[0].title()}
                for m in response.json().get("models", [])
                if m.get("name")
            ]
    except Exception as e:
        print(f"[ollama] Failed to fetch models: {e}")
        return []

async def test_connection() -> tuple[bool, str | None]:
    host = get_base_url()
    if not host:
        return False, "Host URL not configured"

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(f"{host}/api/tags")
            return (
                (True, None)
                if response.is_success
                else (False, f"Server returned status {response.status_code}")
            )
    except Exception as e:
        return False, f"Connection failed: {str(e)[:100]}"
