"""Node plugin registry facade.

The builtin plugin is registered at startup via nodes.init(registry).
The registry is injected — nodes/ never imports from backend/.
"""

from __future__ import annotations

from typing import Any

from nodes._registry import (
    bind_plugin_registry,
    get_executor,
    list_node_plugin_metadata,
    list_node_types,
)
from nodes.plugin import register_builtin_plugin

_initialized = False


def init(registry: Any) -> None:
    """Register builtin nodes and bind the plugin registry.

    Called once at application startup from backend/main.py.
    """
    global _initialized
    if _initialized:
        return

    bind_plugin_registry(registry)
    register_builtin_plugin(registry)
    _initialized = True


__all__ = [
    "get_executor",
    "init",
    "list_node_plugin_metadata",
    "list_node_types",
]
