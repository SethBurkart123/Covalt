"""Node executor registry.

Builtins are resolved directly from nodes.plugin. External plugin
executors are resolved via an injected registry (set by nodes.init).
No imports from backend/ — the dependency flows one way.
"""

from __future__ import annotations

from typing import Any, Protocol

from nodes.plugin import BUILTIN_EXECUTOR_MODULES, BUILTIN_EXECUTORS


class PluginRegistryProtocol(Protocol):
    def get_executor(self, node_type: str) -> Any | None: ...
    def list_node_types(self) -> list[str]: ...
    def plugin_for_node_type(self, node_type: str) -> str | None: ...
    def get_plugin_metadata(self, plugin_id: str) -> dict[str, Any] | None: ...


_plugin_registry: PluginRegistryProtocol | None = None


def bind_plugin_registry(registry: PluginRegistryProtocol) -> None:
    global _plugin_registry
    _plugin_registry = registry


def get_executor(node_type: str) -> Any | None:
    builtin = BUILTIN_EXECUTORS.get(node_type)
    if builtin is not None:
        return builtin
    if _plugin_registry is not None:
        return _plugin_registry.get_executor(node_type)
    return None


def list_node_types() -> list[str]:
    types = {
        *BUILTIN_EXECUTOR_MODULES.keys(),
        *BUILTIN_EXECUTORS.keys(),
    }
    if _plugin_registry is not None:
        types.update(_plugin_registry.list_node_types())
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

    if _plugin_registry is None:
        return ""

    plugin_id = _plugin_registry.plugin_for_node_type(node_type)
    if not plugin_id:
        return ""

    plugin_metadata = _plugin_registry.get_plugin_metadata(plugin_id) or {}
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
