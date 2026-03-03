"""Node executor registry backed by plugin registration."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from backend.services.plugin_registry import get_executor as get_plugin_executor
from nodes.plugin import BUILTIN_EXECUTOR_MODULES, BUILTIN_EXECUTORS


@dataclass(frozen=True)
class NodePluginMetadata:
    node_type: str
    module_path: str
    has_execute: bool
    has_materialize: bool
    has_configure_runtime: bool
    has_init_routes: bool


PROVIDER_EXECUTORS: dict[str, Any] = {}
NODE_PLUGIN_METADATA: dict[str, NodePluginMetadata] = {}
_ROUTES_INITIALIZED: set[str] = set()


def get_executor(node_type: str) -> Any | None:
    return (
        PROVIDER_EXECUTORS.get(node_type)
        or BUILTIN_EXECUTORS.get(node_type)
        or get_plugin_executor(node_type)
    )


def list_node_types() -> list[str]:
    types = {
        *BUILTIN_EXECUTOR_MODULES.keys(),
        *BUILTIN_EXECUTORS.keys(),
        *PROVIDER_EXECUTORS.keys(),
    }
    return sorted(types)


def list_node_plugin_metadata() -> list[dict[str, Any]]:
    metadata = [
        {
            "node_type": item.node_type,
            "module_path": item.module_path,
            "has_execute": item.has_execute,
            "has_materialize": item.has_materialize,
            "has_configure_runtime": item.has_configure_runtime,
            "has_init_routes": item.has_init_routes,
        }
        for item in NODE_PLUGIN_METADATA.values()
    ]

    for node_type, module_path in BUILTIN_EXECUTOR_MODULES.items():
        if any(item["node_type"] == node_type for item in metadata):
            continue

        executor = PROVIDER_EXECUTORS.get(node_type) or BUILTIN_EXECUTORS.get(node_type)
        if executor is None:
            executor = get_plugin_executor(node_type)
        if executor is None:
            continue

        metadata.append(_build_metadata_dict(node_type, executor, module_path))

    metadata.sort(key=lambda item: item["node_type"])
    return metadata


def clear_provider_executors() -> None:
    for node_type in list(PROVIDER_EXECUTORS.keys()):
        PROVIDER_EXECUTORS.pop(node_type, None)
        NODE_PLUGIN_METADATA.pop(node_type, None)


def register_provider_executor(
    *,
    node_type: str,
    executor: Any,
    metadata: dict[str, Any] | None = None,
) -> None:
    PROVIDER_EXECUTORS[node_type] = executor
    md = metadata or {}
    module_path = str(md.get("module_path") or f"provider:{md.get('plugin_id', 'unknown')}")
    NODE_PLUGIN_METADATA[node_type] = NodePluginMetadata(
        node_type=node_type,
        module_path=module_path,
        has_execute=bool(md.get("has_execute", callable(getattr(executor, "execute", None)))),
        has_materialize=bool(md.get("has_materialize", callable(getattr(executor, "materialize", None)))),
        has_configure_runtime=bool(
            md.get(
                "has_configure_runtime",
                callable(getattr(executor, "configure_runtime", None)),
            )
        ),
        has_init_routes=bool(md.get("has_init_routes", callable(getattr(executor, "init_routes", None)))),
    )
    _maybe_init_routes(node_type, executor)


def _build_metadata_dict(node_type: str, executor: Any, module_path: str) -> dict[str, Any]:
    return {
        "node_type": node_type,
        "module_path": module_path,
        "has_execute": callable(getattr(executor, "execute", None)),
        "has_materialize": callable(getattr(executor, "materialize", None)),
        "has_configure_runtime": callable(getattr(executor, "configure_runtime", None)),
        "has_init_routes": callable(getattr(executor, "init_routes", None)),
    }


def _maybe_init_routes(node_type: str, executor: Any) -> None:
    if node_type in _ROUTES_INITIALIZED:
        return

    init_routes = getattr(executor, "init_routes", None)
    if not callable(init_routes):
        return

    try:
        from backend.services.node_route_registry import get_node_route_registry

        init_routes(get_node_route_registry())
        _ROUTES_INITIALIZED.add(node_type)
    except Exception:
        return
