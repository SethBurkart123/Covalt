from __future__ import annotations

import logging

from backend.services.plugin_hooks import (
    HookType,
    PluginHooks,
    deregister_hooks,
    dispatch_hook,
    register_hook,
    reset_hooks,
)


def test_register_and_dispatch_single_hook() -> None:
    hooks = PluginHooks()

    hooks.register_hook("plugin.alpha", HookType.ON_NODE_CREATE, lambda context: context["value"] + 1)

    results = hooks.dispatch_hook(HookType.ON_NODE_CREATE, {"value": 2})

    assert results == [3]


def test_dispatch_without_handlers_returns_empty_list() -> None:
    hooks = PluginHooks()

    assert hooks.dispatch_hook(HookType.ON_NODE_CREATE, {"value": 1}) == []


def test_dispatch_preserves_registration_order() -> None:
    hooks = PluginHooks()
    calls: list[str] = []

    hooks.register_hook(
        "plugin.alpha",
        HookType.ON_NODE_CREATE,
        lambda context: calls.append(f"alpha:{context['value']}") or "alpha",
    )
    hooks.register_hook(
        "plugin.beta",
        HookType.ON_NODE_CREATE,
        lambda context: calls.append(f"beta:{context['value']}") or "beta",
    )

    results = hooks.dispatch_hook(HookType.ON_NODE_CREATE, {"value": "x"})

    assert calls == ["alpha:x", "beta:x"]
    assert results == ["alpha", "beta"]


def test_hooks_are_isolated_by_hook_type() -> None:
    hooks = PluginHooks()

    hooks.register_hook("plugin.alpha", HookType.ON_NODE_CREATE, lambda _context: "node")
    hooks.register_hook("plugin.alpha", HookType.ON_ROUTE_EXTRACT, lambda _context: "route")

    node_results = hooks.dispatch_hook(HookType.ON_NODE_CREATE, {})
    route_results = hooks.dispatch_hook(HookType.ON_ROUTE_EXTRACT, {})

    assert node_results == ["node"]
    assert route_results == ["route"]


def test_dispatch_isolates_hook_failures(caplog) -> None:
    hooks = PluginHooks()

    def failing(_context: dict[str, object]) -> None:
        raise RuntimeError("boom")

    hooks.register_hook("plugin.bad", HookType.ON_NODE_CREATE, failing)
    hooks.register_hook("plugin.good", HookType.ON_NODE_CREATE, lambda _context: "ok")

    with caplog.at_level(logging.ERROR):
        results = hooks.dispatch_hook(HookType.ON_NODE_CREATE, {"value": 1})

    assert results == ["ok"]
    assert "plugin.bad" in caplog.text
    assert "onNodeCreate" in caplog.text


def test_deregister_hooks_removes_only_target_plugin() -> None:
    hooks = PluginHooks()

    hooks.register_hook("plugin.alpha", HookType.ON_NODE_CREATE, lambda _context: "alpha")
    hooks.register_hook("plugin.beta", HookType.ON_NODE_CREATE, lambda _context: "beta")

    hooks.deregister_hooks("plugin.alpha")
    results = hooks.dispatch_hook(HookType.ON_NODE_CREATE, {})

    assert results == ["beta"]


def test_deregister_unknown_plugin_is_noop() -> None:
    hooks = PluginHooks()

    hooks.register_hook("plugin.alpha", HookType.ON_NODE_CREATE, lambda _context: "alpha")

    hooks.deregister_hooks("plugin.unknown")

    assert hooks.dispatch_hook(HookType.ON_NODE_CREATE, {}) == ["alpha"]


def test_same_plugin_can_register_multiple_hook_types() -> None:
    hooks = PluginHooks()

    hooks.register_hook("plugin.alpha", HookType.ON_NODE_CREATE, lambda _context: "node")
    hooks.register_hook("plugin.alpha", HookType.ON_ENTRY_RESOLVE, lambda _context: "entry")
    hooks.register_hook("plugin.alpha", HookType.ON_RESPONSE_EXTRACT, lambda _context: "response")

    assert hooks.dispatch_hook(HookType.ON_NODE_CREATE, {}) == ["node"]
    assert hooks.dispatch_hook(HookType.ON_ENTRY_RESOLVE, {}) == ["entry"]
    assert hooks.dispatch_hook(HookType.ON_RESPONSE_EXTRACT, {}) == ["response"]


def test_clear_resets_all_hooks() -> None:
    hooks = PluginHooks()
    hooks.register_hook("plugin.alpha", HookType.ON_NODE_CREATE, lambda _context: "alpha")

    hooks.clear()

    assert hooks.dispatch_hook(HookType.ON_NODE_CREATE, {}) == []


def test_list_hooks_returns_plugin_and_handler_pairs() -> None:
    hooks = PluginHooks()

    def handler(_context: dict[str, object]) -> str:
        return "alpha"

    hooks.register_hook("plugin.alpha", HookType.ON_NODE_CREATE, handler)

    listed = hooks.list_hooks(HookType.ON_NODE_CREATE)

    assert len(listed) == 1
    assert listed[0][0] == "plugin.alpha"
    assert listed[0][1] is handler


def test_module_level_helpers_use_default_registry() -> None:
    reset_hooks()
    try:
        register_hook("plugin.alpha", HookType.ON_NODE_CREATE, lambda _context: "alpha")
        register_hook("plugin.beta", HookType.ON_NODE_CREATE, lambda _context: "beta")

        assert dispatch_hook(HookType.ON_NODE_CREATE, {}) == ["alpha", "beta"]

        deregister_hooks("plugin.alpha")
        assert dispatch_hook(HookType.ON_NODE_CREATE, {}) == ["beta"]
    finally:
        reset_hooks()
