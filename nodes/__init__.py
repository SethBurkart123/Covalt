"""Node plugin registry facade.

Builtin executors and hooks are registered through the plugin API at import-time,
with lazy wrappers to avoid circular imports during bootstrap.
"""

from __future__ import annotations

import importlib
import threading
from typing import Any

_BUILTIN_REGISTERED = False
_REGISTER_LOCK = threading.Lock()


def _try_register_builtin_plugin() -> None:
    global _BUILTIN_REGISTERED

    if _BUILTIN_REGISTERED:
        return

    with _REGISTER_LOCK:
        if _BUILTIN_REGISTERED:
            return

        plugin_registry = importlib.import_module("backend.services.plugin_registry")
        registry = getattr(plugin_registry, "_DEFAULT_PLUGIN_REGISTRY", None)
        if registry is None:
            # plugin_registry is still initializing; retry on next access
            return

        plugin_module = importlib.import_module("nodes.plugin")
        register_builtin_plugin = getattr(plugin_module, "register_builtin_plugin", None)
        if not callable(register_builtin_plugin):
            return

        already_registered_error = getattr(
            plugin_registry,
            "PluginAlreadyRegisteredError",
            RuntimeError,
        )

        try:
            register_builtin_plugin(registry)
        except already_registered_error:
            pass

        _BUILTIN_REGISTERED = True


def _registry_module() -> Any:
    _try_register_builtin_plugin()
    return importlib.import_module("nodes._registry")


def get_executor(node_type: str) -> Any | None:
    return _registry_module().get_executor(node_type)


def list_node_types() -> list[str]:
    return _registry_module().list_node_types()


def list_node_plugin_metadata() -> list[dict[str, Any]]:
    return _registry_module().list_node_plugin_metadata()


def clear_provider_executors() -> None:
    _registry_module().clear_provider_executors()


def register_provider_executor(
    *,
    node_type: str,
    executor: Any,
    metadata: dict[str, Any] | None = None,
) -> None:
    _registry_module().register_provider_executor(
        node_type=node_type,
        executor=executor,
        metadata=metadata,
    )


# Attempt registration immediately when safe; if plugin registry is still
# initializing, wrappers above will retry on first access.
_try_register_builtin_plugin()

__all__ = [
    "clear_provider_executors",
    "get_executor",
    "list_node_plugin_metadata",
    "list_node_types",
    "register_provider_executor",
]
