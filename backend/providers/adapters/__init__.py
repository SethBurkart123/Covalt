"""Provider adapter registry.

Each adapter module knows how to create provider functions for a specific
protocol family (e.g. OpenAI-compatible, Anthropic-compatible).  Adapters
register themselves via ``register_adapter`` and the manifest loader calls
``get_adapter`` to resolve them by name.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Dict

ADAPTER_REGISTRY: dict[str, Callable[..., dict[str, Any]]] = {}


def register_adapter(name: str, create_fn: Callable[..., dict[str, Any]]) -> None:
    ADAPTER_REGISTRY[name] = create_fn


def get_adapter(name: str) -> Callable[..., dict[str, Any]]:
    if name not in ADAPTER_REGISTRY:
        raise KeyError(
            f"Unknown adapter '{name}'. Registered: {', '.join(ADAPTER_REGISTRY)}"
        )
    return ADAPTER_REGISTRY[name]
