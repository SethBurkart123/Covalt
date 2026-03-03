from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from backend.services.plugin_hooks import PluginHooks
from nodes._types import HookType


class PluginRegistryError(RuntimeError):
    """Base error for plugin registry failures."""


class PluginAlreadyRegisteredError(PluginRegistryError):
    """Raised when registering a plugin id that already exists."""


class NodeTypeCollisionError(PluginRegistryError):
    """Raised when two plugins register the same node type."""


@dataclass(frozen=True)
class PluginRegistrationInput:
    plugin_id: str
    executors: dict[str, Any] = field(default_factory=dict)
    hooks: dict[HookType, list[Any]] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)


class PluginRegistry:
    """Central registry for plugin executors and lifecycle hooks."""

    def __init__(self, hooks: PluginHooks | None = None) -> None:
        self._hooks = hooks or PluginHooks()
        self._plugin_order: list[str] = []
        self._plugin_metadata: dict[str, dict[str, Any]] = {}
        self._plugin_node_types: dict[str, set[str]] = {}
        self._executor_by_type: dict[str, Any] = {}
        self._executor_owner: dict[str, str] = {}

    def register_plugin(
        self,
        plugin_id: str,
        *,
        executors: dict[str, Any] | None = None,
        hooks: dict[HookType, list[Any]] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        normalized_id = _normalize_plugin_id(plugin_id)
        if normalized_id in self._plugin_metadata:
            raise PluginAlreadyRegisteredError(
                f"Plugin '{normalized_id}' is already registered"
            )

        executor_map = executors or {}
        hook_map = hooks or {}

        self._validate_executors(normalized_id, executor_map)
        self._validate_hooks(hook_map)

        self._plugin_order.append(normalized_id)
        self._plugin_metadata[normalized_id] = dict(metadata or {})
        self._plugin_node_types[normalized_id] = set()

        for node_type, executor in executor_map.items():
            self._executor_by_type[node_type] = executor
            self._executor_owner[node_type] = normalized_id
            self._plugin_node_types[normalized_id].add(node_type)

        for hook_type, handlers in hook_map.items():
            for handler in handlers:
                self._hooks.register_hook(normalized_id, hook_type, handler)

    def register_plugins(
        self,
        registrations: list[PluginRegistrationInput],
    ) -> list[str]:
        ordered = sorted(registrations, key=_plugin_sort_key)
        for registration in ordered:
            self.register_plugin(
                registration.plugin_id,
                executors=registration.executors,
                hooks=registration.hooks,
                metadata=registration.metadata,
            )
        return [item.plugin_id for item in ordered]

    def deregister_plugin(self, plugin_id: str) -> bool:
        normalized_id = plugin_id.strip() if isinstance(plugin_id, str) else ""
        if not normalized_id or normalized_id not in self._plugin_metadata:
            return False

        for node_type in self._plugin_node_types.get(normalized_id, set()):
            self._executor_by_type.pop(node_type, None)
            self._executor_owner.pop(node_type, None)

        self._hooks.deregister_hooks(normalized_id)

        self._plugin_node_types.pop(normalized_id, None)
        self._plugin_metadata.pop(normalized_id, None)
        self._plugin_order = [pid for pid in self._plugin_order if pid != normalized_id]
        return True

    def get_executor(self, node_type: str) -> Any | None:
        return self._executor_by_type.get(node_type)

    def dispatch_hook(self, hook_type: HookType, context: dict[str, Any]) -> list[Any]:
        return self._hooks.dispatch_hook(hook_type, context)

    def list_registered_plugins(self) -> list[str]:
        return list(self._plugin_order)

    def list_node_types(self) -> list[str]:
        return sorted(self._executor_by_type.keys())

    def plugin_for_node_type(self, node_type: str) -> str | None:
        return self._executor_owner.get(node_type)

    def get_plugin_metadata(self, plugin_id: str) -> dict[str, Any] | None:
        metadata = self._plugin_metadata.get(plugin_id)
        if metadata is None:
            return None
        return dict(metadata)

    def clear(self) -> None:
        self._plugin_order.clear()
        self._plugin_metadata.clear()
        self._plugin_node_types.clear()
        self._executor_by_type.clear()
        self._executor_owner.clear()
        self._hooks.clear()

    def _validate_executors(self, plugin_id: str, executors: dict[str, Any]) -> None:
        for node_type in executors.keys():
            if not isinstance(node_type, str) or not node_type.strip():
                raise ValueError("executor node_type must be a non-empty string")
            owner = self._executor_owner.get(node_type)
            if owner and owner != plugin_id:
                raise NodeTypeCollisionError(
                    f"Node type '{node_type}' already registered by plugin '{owner}'"
                )

    def _validate_hooks(self, hooks: dict[HookType, list[Any]]) -> None:
        for hook_type, handlers in hooks.items():
            if not isinstance(hook_type, HookType):
                raise TypeError(
                    f"hook type keys must be HookType values; got {hook_type!r}"
                )
            for handler in handlers:
                if not callable(handler):
                    raise TypeError("hook handlers must be callable")


_DEFAULT_PLUGIN_REGISTRY = PluginRegistry()


def register_plugin(
    plugin_id: str,
    *,
    executors: dict[str, Any] | None = None,
    hooks: dict[HookType, list[Any]] | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    _DEFAULT_PLUGIN_REGISTRY.register_plugin(
        plugin_id,
        executors=executors,
        hooks=hooks,
        metadata=metadata,
    )


def register_plugins(registrations: list[PluginRegistrationInput]) -> list[str]:
    return _DEFAULT_PLUGIN_REGISTRY.register_plugins(registrations)


def deregister_plugin(plugin_id: str) -> bool:
    return _DEFAULT_PLUGIN_REGISTRY.deregister_plugin(plugin_id)


def unregister_plugin(plugin_id: str) -> bool:
    return deregister_plugin(plugin_id)


def get_executor(node_type: str) -> Any | None:
    return _DEFAULT_PLUGIN_REGISTRY.get_executor(node_type)


def list_node_types() -> list[str]:
    return _DEFAULT_PLUGIN_REGISTRY.list_node_types()


def plugin_for_node_type(node_type: str) -> str | None:
    return _DEFAULT_PLUGIN_REGISTRY.plugin_for_node_type(node_type)


def list_registered_plugins() -> list[str]:
    return _DEFAULT_PLUGIN_REGISTRY.list_registered_plugins()


def get_plugin_metadata(plugin_id: str) -> dict[str, Any] | None:
    return _DEFAULT_PLUGIN_REGISTRY.get_plugin_metadata(plugin_id)


def dispatch_hook(hook_type: HookType, context: dict[str, Any]) -> list[Any]:
    return _DEFAULT_PLUGIN_REGISTRY.dispatch_hook(hook_type, context)


def reset_registry() -> None:
    _DEFAULT_PLUGIN_REGISTRY.clear()


def _normalize_plugin_id(plugin_id: str) -> str:
    if not isinstance(plugin_id, str) or not plugin_id.strip():
        raise ValueError("plugin_id must be a non-empty string")
    return plugin_id.strip()


def _plugin_sort_key(registration: PluginRegistrationInput) -> tuple[int, str]:
    metadata = registration.metadata or {}
    is_builtin = bool(metadata.get("is_builtin")) or registration.plugin_id == "builtin"
    priority = 0 if is_builtin else 1
    return (priority, registration.plugin_id.lower())
