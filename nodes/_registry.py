"""Node executor registry backed by plugin registration."""

from __future__ import annotations

from typing import Any

from backend.services.plugins.plugin_registry import (
    get_executor as get_plugin_executor,
)
from backend.services.plugins.plugin_registry import (
    get_plugin_metadata,
    plugin_for_node_type,
)
from backend.services.plugins.plugin_registry import (
    list_node_types as list_plugin_node_types,
)
from nodes.plugin import BUILTIN_EXECUTOR_MODULES, BUILTIN_EXECUTORS


def get_executor(node_type: str) -> Any | None:
    return BUILTIN_EXECUTORS.get(node_type) or get_plugin_executor(node_type)


def list_node_types() -> list[str]:
    types = {
        *BUILTIN_EXECUTOR_MODULES.keys(),
        *BUILTIN_EXECUTORS.keys(),
        *list_plugin_node_types(),
    }
    return sorted(types)


def list_node_plugin_metadata() -> list[dict[str, Any]]:
    metadata: list[dict[str, Any]] = []

    for node_type in list_node_types():
        executor = get_executor(node_type)
        if executor is None:
            continue

        module_path = _resolve_module_path(node_type)
        metadata.append(_build_metadata_dict(node_type, executor, module_path))

    metadata.sort(key=lambda item: item["node_type"])
    return metadata


def _resolve_module_path(node_type: str) -> str:
    builtin_module = BUILTIN_EXECUTOR_MODULES.get(node_type)
    if builtin_module is not None:
        return builtin_module

    plugin_id = plugin_for_node_type(node_type)
    if not plugin_id:
        return ""

    plugin_metadata = get_plugin_metadata(plugin_id) or {}
    if plugin_metadata.get("source") == "provider":
        return f"provider:{plugin_id}"

    return f"plugin:{plugin_id}"


def _build_metadata_dict(node_type: str, executor: Any, module_path: str) -> dict[str, Any]:
    return {
        "node_type": node_type,
        "module_path": module_path,
        "has_execute": callable(getattr(executor, "execute", None)),
        "has_materialize": callable(getattr(executor, "materialize", None)),
        "has_configure_runtime": callable(getattr(executor, "configure_runtime", None)),
        "has_init_routes": callable(getattr(executor, "init_routes", None)),
    }
