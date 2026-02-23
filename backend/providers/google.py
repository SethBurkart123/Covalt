"""Google Provider - Gemini models via Google AI Studio or Vertex AI"""

from typing import Any, Dict, List
import httpx
from agno.models.litellm import LiteLLM
from . import get_api_key, get_extra_config
from .options import resolve_common_options
from .. import db

ALIASES = ["gemini", "google_ai_studio"]
GOOGLE_THINKING_BUDGET_MAX = 32768
VERTEX_THINKING_BUDGET_MAX = 24576


def get_google_model(
    model_id: str,
    provider_options: Dict[str, Any],
) -> LiteLLM:
    """Create a Google Gemini model instance."""
    api_key = get_api_key()
    extra = get_extra_config()
    is_vertex_enabled = _is_vertex_enabled(extra)

    if not api_key and not is_vertex_enabled:
        raise RuntimeError("Google API key not configured in Settings.")

    options = provider_options
    request_params: Dict[str, Any] = dict(options.get("request_params") or {})
    if is_vertex_enabled:
        thinking = request_params.get("thinking")
        if isinstance(thinking, dict):
            budget = _coerce_non_negative_int(
                thinking.get("budget_tokens"),
                default=0,
            )
            request_params["thinking"] = {
                **thinking,
                "budget_tokens": min(budget, VERTEX_THINKING_BUDGET_MAX),
            }
        request_params.update(
            {
                "vertex_project": extra.get("project_id"),
                "vertex_location": extra.get("location"),
            }
        )
    if request_params:
        options["request_params"] = request_params

    return LiteLLM(id=f"gemini/{model_id}", api_key=api_key, **options)


def resolve_options(
    model_id: str,
    model_options: Dict[str, Any] | None,
    node_params: Dict[str, Any] | None,
) -> Dict[str, Any]:
    _ = model_id
    options = model_options or {}
    resolved = resolve_common_options(model_options, node_params)

    if "thinking_budget" in options:
        budget = _coerce_non_negative_int(options.get("thinking_budget"), default=0)
        budget = min(budget, _max_thinking_budget())
        resolved["request_params"] = {
            "thinking": {
                "type": "enabled",
                "budget_tokens": budget,
            }
        }

    return resolved


async def fetch_models() -> List[Dict[str, Any]]:
    """Fetch available models from Google AI Studio API."""
    api_key = get_api_key()
    if not api_key:
        return []

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(
                f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
            )

            if not response.is_success:
                return []

            models = []
            for m in response.json().get("models", []):
                model_id = m.get("name", "").split("/")[-1] or m.get("baseModelId", "")

                if not model_id:
                    continue

                max_output_tokens = _coerce_positive_int(
                    m.get("outputTokenLimit"),
                    default=8192,
                )
                model_info = {
                    "id": model_id,
                    "name": m.get("displayName", model_id),
                    "supports_reasoning": m.get("thinking", False),
                    "max_output_tokens": max_output_tokens,
                }
                models.append(model_info)

                if model_info["supports_reasoning"]:
                    _save_reasoning_metadata(model_id)

            return models

    except Exception as e:
        print(f"[google] Failed to fetch models: {e}")
        return []


def get_model_options(
    model_id: str,
    model_metadata: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    """Return Google Gemini options for a model."""
    metadata = model_metadata or {}
    max_output_tokens = _coerce_positive_int(
        metadata.get("max_output_tokens"),
        default=8192,
    )
    supports_reasoning = bool(metadata.get("supports_reasoning", False))
    thinking_budget_max = _max_thinking_budget()

    main: list[dict[str, Any]] = []
    if supports_reasoning:
        main.append(
            {
                "key": "thinking_budget",
                "label": "Thinking Budget",
                "type": "slider",
                "min": 0,
                "max": thinking_budget_max,
                "step": 512,
                "default": 8192,
            }
        )

    return {
        "main": main,
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
                "key": "max_tokens",
                "label": "Max Tokens",
                "type": "number",
                "min": 1,
                "max": max_output_tokens,
                "default": min(4096, max_output_tokens),
            },
        ],
    }


async def test_connection() -> tuple[bool, str | None]:
    """Test connection to Google AI Studio API."""
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


def _save_reasoning_metadata(model_id: str):
    """Save reasoning capability to database for later use."""
    with db.db_session() as sess:
        db.upsert_model_settings(
            sess,
            provider="google",
            model_id=model_id,
            reasoning={"supports": True, "isUserOverride": False},
        )


def _coerce_positive_int(value: Any, *, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def _coerce_non_negative_int(value: Any, *, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed >= 0 else default


def _max_thinking_budget() -> int:
    extra = get_extra_config()
    if _is_vertex_enabled(extra):
        return VERTEX_THINKING_BUDGET_MAX
    return GOOGLE_THINKING_BUDGET_MAX


def _is_vertex_enabled(extra: Dict[str, Any]) -> bool:
    raw = extra.get("vertexai")
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, str):
        return raw.strip().lower() in {"1", "true", "yes", "on"}
    return bool(raw)
