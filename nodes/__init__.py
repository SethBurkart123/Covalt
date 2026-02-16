"""Node plugin system. Auto-discovers executors from subdirectories."""

from nodes._registry import EXECUTORS, get_executor, list_node_types

__all__ = ["EXECUTORS", "get_executor", "list_node_types"]
