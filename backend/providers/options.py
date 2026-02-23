from __future__ import annotations

from typing import Any, Dict

COMMON_OPTION_KEYS = (
    "temperature",
    "max_tokens",
    "top_p",
    "frequency_penalty",
    "presence_penalty",
    "stop",
)


def resolve_common_options(
    model_options: Dict[str, Any] | None,
    node_params: Dict[str, Any] | None,
) -> Dict[str, Any]:
    options = model_options or {}
    params = node_params or {}
    resolved: Dict[str, Any] = {}

    for key in COMMON_OPTION_KEYS:
        value = params.get(key)
        if value is None:
            value = options.get(key)
        if value is not None:
            resolved[key] = value

    return resolved
