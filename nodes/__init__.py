"""Node plugin system. Auto-discovers executors from subdirectories."""

from nodes._registry import (
    EXECUTORS,
    NODE_PLUGIN_METADATA,
    clear_provider_executors,
    get_executor,
    list_node_plugin_metadata,
    list_node_types,
    register_provider_executor,
)

__all__ = [
    "EXECUTORS",
    "NODE_PLUGIN_METADATA",
    "clear_provider_executors",
    "get_executor",
    "list_node_plugin_metadata",
    "list_node_types",
    "register_provider_executor",
]
