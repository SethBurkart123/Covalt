"""Node plugin system. Auto-discovers executors from subdirectories."""

from nodes._registry import (
    EXECUTORS,
    NODE_PLUGIN_METADATA,
    get_executor,
    list_node_plugin_metadata,
    list_node_types,
)

__all__ = [
    "EXECUTORS",
    "NODE_PLUGIN_METADATA",
    "get_executor",
    "list_node_plugin_metadata",
    "list_node_types",
]
