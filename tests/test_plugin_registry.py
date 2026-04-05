from __future__ import annotations

import pytest

from backend.services.plugins.plugin_registry import (
    NodeTypeCollisionError,
    PluginAlreadyRegisteredError,
    PluginRegistrationInput,
    PluginRegistry,
    deregister_plugin,
    dispatch_hook,
    get_executor,
    register_plugin,
    reset_registry,
)
from nodes._types import HookType


class _Executor:
    def __init__(self, node_type: str) -> None:
        self.node_type = node_type


class TestPluginRegistry:
    def test_registers_executors_indexed_by_node_type(self) -> None:
        registry = PluginRegistry()
        executor = _Executor("chat-start")

        registry.register_plugin("builtin", executors={"chat-start": executor})

        assert registry.get_executor("chat-start") is executor
        assert registry.plugin_for_node_type("chat-start") == "builtin"

    def test_registers_hooks_and_dispatches_them(self) -> None:
        registry = PluginRegistry()

        registry.register_plugin(
            "plugin.alpha",
            hooks={HookType.ON_NODE_CREATE: [lambda context: context["value"] + 3]},
        )

        assert registry.dispatch_hook(HookType.ON_NODE_CREATE, {"value": 4}) == [7]

    def test_deregister_removes_executors_and_hooks(self) -> None:
        registry = PluginRegistry()
        executor = _Executor("reroute")

        registry.register_plugin(
            "plugin.alpha",
            executors={"reroute": executor},
            hooks={HookType.ON_ROUTE_EXTRACT: [lambda _context: "route-1"]},
        )

        assert registry.deregister_plugin("plugin.alpha") is True
        assert registry.get_executor("reroute") is None
        assert registry.dispatch_hook(HookType.ON_ROUTE_EXTRACT, {}) == []

    def test_deregister_unknown_plugin_returns_false(self) -> None:
        registry = PluginRegistry()

        assert registry.deregister_plugin("unknown") is False

    def test_rejects_node_type_collisions(self) -> None:
        registry = PluginRegistry()

        registry.register_plugin("plugin.alpha", executors={"shared": _Executor("shared")})

        with pytest.raises(NodeTypeCollisionError, match="shared"):
            registry.register_plugin("plugin.beta", executors={"shared": _Executor("shared")})

        assert registry.plugin_for_node_type("shared") == "plugin.alpha"

    def test_rejects_duplicate_plugin_id_registration(self) -> None:
        registry = PluginRegistry()

        registry.register_plugin("plugin.alpha")

        with pytest.raises(PluginAlreadyRegisteredError):
            registry.register_plugin("plugin.alpha")

    def test_register_plugins_loads_builtin_first_then_external_alphabetically(self) -> None:
        registry = PluginRegistry()
        calls: list[str] = []

        def _record(plugin_id: str):
            return lambda _context: calls.append(plugin_id) or plugin_id

        order = registry.register_plugins(
            [
                PluginRegistrationInput(
                    plugin_id="zeta",
                    hooks={HookType.ON_NODE_CREATE: [_record("zeta")]},
                ),
                PluginRegistrationInput(
                    plugin_id="builtin",
                    metadata={"is_builtin": True},
                    hooks={HookType.ON_NODE_CREATE: [_record("builtin")]},
                ),
                PluginRegistrationInput(
                    plugin_id="alpha",
                    hooks={HookType.ON_NODE_CREATE: [_record("alpha")]},
                ),
            ]
        )

        assert order == ["builtin", "alpha", "zeta"]
        assert registry.list_registered_plugins() == ["builtin", "alpha", "zeta"]
        assert registry.dispatch_hook(HookType.ON_NODE_CREATE, {}) == ["builtin", "alpha", "zeta"]
        assert calls == ["builtin", "alpha", "zeta"]

    def test_register_plugins_treats_builtin_id_as_builtin_even_without_metadata(self) -> None:
        registry = PluginRegistry()

        order = registry.register_plugins(
            [
                PluginRegistrationInput(plugin_id="zeta"),
                PluginRegistrationInput(plugin_id="builtin"),
                PluginRegistrationInput(plugin_id="alpha"),
            ]
        )

        assert order == ["builtin", "alpha", "zeta"]

    def test_register_plugins_collision_is_deterministic_based_on_sorted_order(self) -> None:
        registry = PluginRegistry()
        alpha_executor = _Executor("shared")

        with pytest.raises(NodeTypeCollisionError, match="plugin 'alpha'"):
            registry.register_plugins(
                [
                    PluginRegistrationInput(
                        plugin_id="zeta",
                        executors={"shared": _Executor("shared")},
                    ),
                    PluginRegistrationInput(
                        plugin_id="alpha",
                        executors={"shared": alpha_executor},
                    ),
                ]
            )

        assert registry.get_executor("shared") is alpha_executor
        assert registry.list_registered_plugins() == ["alpha"]

    def test_list_node_types_is_sorted_for_determinism(self) -> None:
        registry = PluginRegistry()

        registry.register_plugin(
            "plugin.alpha",
            executors={
                "zeta-node": _Executor("zeta-node"),
                "alpha-node": _Executor("alpha-node"),
            },
        )

        assert registry.list_node_types() == ["alpha-node", "zeta-node"]

    def test_get_plugin_metadata_returns_copy(self) -> None:
        registry = PluginRegistry()
        metadata = {"source": "external", "priority": 10}

        registry.register_plugin("plugin.alpha", metadata=metadata)
        loaded = registry.get_plugin_metadata("plugin.alpha")

        assert loaded == metadata
        assert loaded is not metadata

        loaded["source"] = "mutated"
        assert registry.get_plugin_metadata("plugin.alpha") == metadata

    def test_clear_resets_registry_state(self) -> None:
        registry = PluginRegistry()

        registry.register_plugin(
            "plugin.alpha",
            executors={"agent": _Executor("agent")},
            hooks={HookType.ON_ENTRY_RESOLVE: [lambda _context: "entry"]},
        )

        registry.clear()

        assert registry.list_registered_plugins() == []
        assert registry.list_node_types() == []
        assert registry.dispatch_hook(HookType.ON_ENTRY_RESOLVE, {}) == []

    def test_register_plugin_rejects_blank_node_type(self) -> None:
        registry = PluginRegistry()

        with pytest.raises(ValueError, match="node_type"):
            registry.register_plugin("plugin.alpha", executors={"": _Executor("")})

    def test_register_plugin_rejects_non_callable_hook(self) -> None:
        registry = PluginRegistry()

        with pytest.raises(TypeError, match="callable"):
            registry.register_plugin("plugin.alpha", hooks={HookType.ON_NODE_CREATE: ["bad"]})

    def test_register_plugin_rejects_non_hook_type_keys(self) -> None:
        registry = PluginRegistry()

        with pytest.raises(TypeError, match="HookType"):
            registry.register_plugin(
                "plugin.alpha",
                hooks={"onNodeCreate": [lambda _context: "ok"]},  # type: ignore[arg-type]
            )


class TestPluginRegistryModuleHelpers:
    def test_module_level_registration_and_deregistration(self) -> None:
        reset_registry()
        try:
            executor = _Executor("webhook-trigger")
            register_plugin(
                "plugin.alpha",
                executors={"webhook-trigger": executor},
                hooks={HookType.ON_ROUTE_EXTRACT: [lambda _context: "route"]},
            )

            assert get_executor("webhook-trigger") is executor
            assert dispatch_hook(HookType.ON_ROUTE_EXTRACT, {}) == ["route"]

            assert deregister_plugin("plugin.alpha") is True
            assert get_executor("webhook-trigger") is None
            assert dispatch_hook(HookType.ON_ROUTE_EXTRACT, {}) == []
        finally:
            reset_registry()
