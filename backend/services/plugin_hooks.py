from __future__ import annotations

import logging
from collections import defaultdict
from collections.abc import Callable
from typing import Any

from nodes._types import HookType

logger = logging.getLogger(__name__)

HookHandler = Callable[[dict[str, Any]], Any]


class PluginHooks:
    """Stores lifecycle hooks and dispatches them in registration order."""

    def __init__(self) -> None:
        self._hooks: dict[HookType, list[tuple[str, HookHandler]]] = defaultdict(list)

    def register_hook(
        self,
        plugin_id: str,
        hook_type: HookType,
        handler: HookHandler,
    ) -> None:
        if not isinstance(plugin_id, str) or not plugin_id.strip():
            raise ValueError("plugin_id must be a non-empty string")
        if not callable(handler):
            raise TypeError("handler must be callable")

        self._hooks[hook_type].append((plugin_id, handler))

    def dispatch_hook(
        self,
        hook_type: HookType,
        context: dict[str, Any],
    ) -> list[Any]:
        results: list[Any] = []

        for plugin_id, handler in list(self._hooks.get(hook_type, [])):
            try:
                result = handler(context)
            except Exception as exc:
                logger.error(
                    "plugin-hooks: %s hook '%s' failed: %s",
                    plugin_id,
                    hook_type.value,
                    exc,
                )
                continue

            if result is not None:
                results.append(result)

        return results

    def deregister_hooks(self, plugin_id: str) -> None:
        for hook_type in HookType:
            entries = self._hooks.get(hook_type, [])
            self._hooks[hook_type] = [item for item in entries if item[0] != plugin_id]

    def list_hooks(self, hook_type: HookType) -> list[tuple[str, HookHandler]]:
        return list(self._hooks.get(hook_type, []))

    def clear(self) -> None:
        self._hooks.clear()


_DEFAULT_PLUGIN_HOOKS = PluginHooks()


def register_hook(plugin_id: str, hook_type: HookType, handler: HookHandler) -> None:
    _DEFAULT_PLUGIN_HOOKS.register_hook(plugin_id, hook_type, handler)


def dispatch_hook(hook_type: HookType, context: dict[str, Any]) -> list[Any]:
    return _DEFAULT_PLUGIN_HOOKS.dispatch_hook(hook_type, context)


def deregister_hooks(plugin_id: str) -> None:
    _DEFAULT_PLUGIN_HOOKS.deregister_hooks(plugin_id)


def reset_hooks() -> None:
    _DEFAULT_PLUGIN_HOOKS.clear()
