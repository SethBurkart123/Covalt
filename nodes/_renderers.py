"""Helpers for `default_renderers` resolution on FlowExecutor implementations.

Executors may set an optional class attribute:

    default_renderers: Mapping[str | re.Pattern[str], str]

mapping tool-name keys (exact case-insensitive string OR compiled regex) to
renderer keys. The first match wins, walking insertion order.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

DEFAULT_RENDERERS_TYPE = Mapping[Any, str]


def resolve_default_renderer(
    default_renderers: Mapping[Any, str] | None,
    tool_name: str | None,
) -> str | None:
    if not default_renderers or not tool_name:
        return None
    for key, value in default_renderers.items():
        if isinstance(key, re.Pattern):
            if key.match(tool_name):
                return value
        elif isinstance(key, str):
            if key.lower() == tool_name.lower():
                return value
    return None
