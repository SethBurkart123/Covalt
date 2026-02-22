"""Anthropic Provider - Claude models via Anthropic API"""

from typing import Any, Dict, List
import httpx
from agno.models.litellm import LiteLLM
from . import get_api_key

ALIASES = ["claude"]


def get_anthropic_model(model_id: str, **kwargs: Any) -> LiteLLM:
    """Create an Anthropic Claude model instance."""
    api_key = get_api_key()

    if not api_key:
        raise RuntimeError("Anthropic API key not configured in Settings.")

    return LiteLLM(id=f"anthropic/{model_id}", api_key=api_key, **kwargs)


async def fetch_models() -> List[Dict[str, Any]]:
    """Fetch available models from Anthropic API."""
    api_key = get_api_key()
    if not api_key:
        return []

    async with httpx.AsyncClient(timeout=5) as client:
        response = await client.get(
            "https://api.anthropic.com/v1/models",
            headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
        )

        if response.is_success:
            models = response.json().get("data", [])
            return [
                {
                    "id": m["id"],
                    "name": m.get("display_name", m["id"]),
                    "supports_thinking": _supports_thinking(m["id"]),
                    "max_output_tokens": _coerce_positive_int(
                        m.get("max_output_tokens"), default=8192
                    ),
                }
                for m in models
            ]

    return []


def get_model_options(
    model_id: str,
    model_metadata: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    """Return Anthropic model option schema."""
    metadata = model_metadata or {}
    max_output_tokens = _coerce_positive_int(
        metadata.get("max_output_tokens"),
        default=8192,
    )

    advanced = [
        {
            "key": "temperature",
            "label": "Temperature",
            "type": "slider",
            "min": 0,
            "max": 1,
            "step": 0.1,
            "default": 1,
        },
        {
            "key": "max_tokens",
            "label": "Max Tokens",
            "type": "number",
            "min": 1,
            "max": max_output_tokens,
            "default": min(4096, max_output_tokens),
        },
    ]

    supports_thinking = bool(metadata.get("supports_thinking", _supports_thinking(model_id)))
    if not supports_thinking:
        return {"main": [], "advanced": advanced}

    return {
        "main": [
            {
                "key": "thinking",
                "label": "Thinking",
                "type": "select",
                "default": "auto",
                "options": [
                    {"value": "none", "label": "Off"},
                    {"value": "auto", "label": "Auto"},
                    {"value": "high", "label": "High"},
                ],
            },
            {
                "key": "thinking_budget",
                "label": "Budget",
                "type": "slider",
                "min": 1024,
                "max": 32000,
                "step": 1024,
                "default": 8000,
                "showWhen": {"option": "thinking", "values": ["high"]},
            },
        ],
        "advanced": advanced,
    }


def map_model_options(model_id: str, options: Dict[str, Any]) -> Dict[str, Any]:
    """Map user-visible options into Anthropic LiteLLM kwargs."""
    _ = model_id
    kwargs: Dict[str, Any] = {}

    if "temperature" in options:
        kwargs["temperature"] = options["temperature"]
    if "max_tokens" in options:
        kwargs["max_tokens"] = options["max_tokens"]

    thinking = str(options.get("thinking", "auto"))
    if thinking == "high":
        budget = _coerce_positive_int(options.get("thinking_budget"), default=8000)
        # litellm.completion() accepts provider reasoning controls via `thinking`.
        kwargs["request_params"] = {
            "thinking": {
                "type": "enabled",
                "budget_tokens": budget,
            }
        }

    return kwargs


async def test_connection() -> tuple[bool, str | None]:
    """Test connection to Anthropic API."""
    api_key = get_api_key()
    if not api_key:
        return False, "API key not configured"

    async with httpx.AsyncClient(timeout=5) as client:
        response = await client.get(
            "https://api.anthropic.com/v1/models",
            headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
        )

        if response.is_success or response.status_code == 400:
            return True, None
        if response.status_code == 401:
            return False, "Invalid API key"
        if response.status_code == 403:
            return False, "Access forbidden - check API key permissions"

        return False, f"API returned status {response.status_code}"


def _supports_thinking(model_id: str) -> bool:
    model = model_id.lower()
    return "claude-3-5" in model or "claude-3-7" in model or "claude-4" in model


def _coerce_positive_int(value: Any, *, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default
