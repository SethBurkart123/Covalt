from __future__ import annotations

from collections.abc import Callable
from typing import Any

ADAPTER_REGISTRY: dict[str, Callable[..., dict[str, Any]]] = {}


def register_adapter(name: str, create_fn: Callable[..., dict[str, Any]]) -> None:
    ADAPTER_REGISTRY[name] = create_fn


def get_adapter(name: str) -> Callable[..., dict[str, Any]]:
    if name not in ADAPTER_REGISTRY:
        raise KeyError(
            f"Unknown adapter '{name}'. Registered: {', '.join(ADAPTER_REGISTRY)}"
        )
    return ADAPTER_REGISTRY[name]
