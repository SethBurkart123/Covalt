"""Node executor auto-discovery.

Scans nodes/**/executor.py, imports each, registers by node_type.
Drop a folder with executor.py, restart, it appears.
"""

from __future__ import annotations

from dataclasses import dataclass
import importlib
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

@dataclass(frozen=True)
class NodePluginMetadata:
    node_type: str
    module_path: str
    has_execute: bool
    has_materialize: bool
    has_configure_runtime: bool
    has_init_routes: bool


# node_type -> executor instance
EXECUTORS: dict[str, Any] = {}
NODE_PLUGIN_METADATA: dict[str, NodePluginMetadata] = {}
_ROUTES_INITIALIZED: set[str] = set()


def _discover() -> None:
    """Walk nodes/**/executor.py and register each executor."""
    root = Path(__file__).parent

    for executor_path in root.rglob("executor.py"):
        # Build the module path: nodes.core.agent.executor -> relative to project root
        relative = executor_path.relative_to(root.parent)
        module_path = str(relative.with_suffix("")).replace("/", ".").replace("\\", ".")

        try:
            module = importlib.import_module(module_path)
            executor = getattr(module, "executor", None)

            if executor is None:
                logger.warning(f"nodes: {module_path} has no 'executor' export")
                continue

            node_type = getattr(executor, "node_type", None)
            if node_type is None:
                logger.warning(f"nodes: {module_path} executor has no 'node_type'")
                continue

            EXECUTORS[node_type] = executor
            NODE_PLUGIN_METADATA[node_type] = NodePluginMetadata(
                node_type=node_type,
                module_path=module_path,
                has_execute=callable(getattr(executor, "execute", None)),
                has_materialize=callable(getattr(executor, "materialize", None)),
                has_configure_runtime=callable(
                    getattr(executor, "configure_runtime", None)
                ),
                has_init_routes=callable(getattr(executor, "init_routes", None)),
            )
            _maybe_init_routes(node_type, executor)
            logger.debug(f"nodes: registered '{node_type}' from {module_path}")

        except Exception as e:
            logger.error(f"nodes: failed to load {module_path}: {e}")


def get_executor(node_type: str) -> Any | None:
    return EXECUTORS.get(node_type)


def list_node_types() -> list[str]:
    return list(EXECUTORS.keys())


def list_node_plugin_metadata() -> list[dict[str, Any]]:
    return [
        {
            "node_type": metadata.node_type,
            "module_path": metadata.module_path,
            "has_execute": metadata.has_execute,
            "has_materialize": metadata.has_materialize,
            "has_configure_runtime": metadata.has_configure_runtime,
            "has_init_routes": metadata.has_init_routes,
        }
        for metadata in NODE_PLUGIN_METADATA.values()
    ]


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
        logger.debug("nodes: initialized routes for '%s'", node_type)
    except Exception as exc:
        logger.error("nodes: failed to init routes for '%s': %s", node_type, exc)


_discover()
