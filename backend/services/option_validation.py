from __future__ import annotations

import json
import math
from typing import Any

from .. import db
from ..models.chat import OptionSchema
from .model_schema_cache import get_effective_option_schema

MAX_OPTION_KEYS = 20
MAX_PAYLOAD_SIZE = 2048  # bytes



class ModelResolutionError(ValueError):
    """Raised when model ID cannot be resolved for a chat request."""


def _effective_chat_model(chat_id: str) -> str | None:
    with db.db_session() as sess:
        chat = sess.get(db.Chat, chat_id)
        config = db.get_chat_agent_config(sess, chat_id) or {}

    if isinstance(config, dict):
        agent_id = config.get("agent_id")
        if isinstance(agent_id, str) and agent_id.strip():
            return f"agent:{agent_id.strip()}"

        provider = str(config.get("provider") or "").strip()
        model_id = str(config.get("model_id") or "").strip()
        if provider and model_id:
            return f"{provider}:{model_id}"
        if model_id and ":" in model_id:
            return model_id

    model = getattr(chat, "model", None) if chat is not None else None
    if isinstance(model, str) and model.strip():
        return model.strip()

    return None


def resolve_model_for_chat(
    chat_id: str | None,
    request_model_id: str | None,
) -> tuple[str, str]:
    """Resolve provider/model for an incoming chat-related request."""
    effective_model_id = request_model_id.strip() if request_model_id else None

    if not effective_model_id and chat_id:
        effective_model_id = _effective_chat_model(chat_id)

    if not effective_model_id:
        raise ModelResolutionError("No model specified and chat has no configured model")

    if ":" not in effective_model_id:
        raise ModelResolutionError(
            f"Invalid model ID format: '{effective_model_id}'. Expected 'provider:model_id'"
        )

    provider, model_id = effective_model_id.split(":", 1)
    provider = provider.strip()
    model_id = model_id.strip()
    if not provider or not model_id:
        raise ModelResolutionError(
            f"Invalid model ID format: '{effective_model_id}'. Expected 'provider:model_id'"
        )

    return provider, model_id


def resolve_and_validate_model_options(
    chat_id: str | None,
    request_model_id: str | None,
    request_options: Any,
) -> dict[str, Any]:
    """Resolve effective model context then validate request options against its schema."""
    provider, model_id = resolve_model_for_chat(chat_id, request_model_id)
    schema = get_effective_option_schema(provider, model_id)
    return validate_model_options(request_options, schema)


def _ensure_dict(name: str, value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    raise ValueError(f"{name} must be an object")


def _payload_size(options: dict[str, Any]) -> int:
    serialized = json.dumps(options, separators=(",", ":"), ensure_ascii=False)
    return len(serialized.encode("utf-8"))


def validate_model_options(options: Any, schema: OptionSchema) -> dict[str, Any]:
    """Validate request model options and fill missing schema defaults."""
    provided = _ensure_dict("modelOptions", options)

    if len(provided) > MAX_OPTION_KEYS:
        raise ValueError(f"Too many option keys: {len(provided)} > {MAX_OPTION_KEYS}")

    serialized_size = _payload_size(provided)
    if serialized_size > MAX_PAYLOAD_SIZE:
        raise ValueError(
            "Options payload too large: "
            f"{serialized_size} > {MAX_PAYLOAD_SIZE} bytes"
        )

    all_defs = {definition.key: definition for definition in schema.main + schema.advanced}

    for key in provided:
        if key not in all_defs:
            raise ValueError(f"Unknown option key: {key}")

    validated: dict[str, Any] = {}
    for key, definition in all_defs.items():
        if key not in provided:
            validated[key] = definition.default
            continue

        value = provided[key]
        if definition.type == "select":
            allowed_values = [choice.value for choice in definition.options or []]
            if value not in allowed_values:
                raise ValueError(f"Invalid value for {key}: {value}")
        elif definition.type in {"number", "slider"}:
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError(f"{key} must be numeric")
            if not math.isfinite(value):
                raise ValueError(f"{key} must be finite")
            if definition.min is not None and value < definition.min:
                raise ValueError(f"{key} below minimum ({definition.min})")
            if definition.max is not None and value > definition.max:
                raise ValueError(f"{key} above maximum ({definition.max})")
        elif definition.type == "boolean":
            if not isinstance(value, bool):
                raise ValueError(f"{key} must be boolean")

        validated[key] = value

    return validated

