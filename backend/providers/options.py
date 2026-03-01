from __future__ import annotations

from typing import Any

COMMON_OPTION_KEYS = (
    "temperature",
    "max_tokens",
    "top_p",
    "frequency_penalty",
    "presence_penalty",
    "stop",
)


def resolve_common_options(
    model_options: dict[str, Any] | None,
    node_params: dict[str, Any] | None,
) -> dict[str, Any]:
    options = model_options or {}
    params = node_params or {}
    resolved: dict[str, Any] = {}

    for key in COMMON_OPTION_KEYS:
        value = params.get(key)
        if value is None:
            value = options.get(key)
        if value is not None:
            resolved[key] = value

    return resolved
