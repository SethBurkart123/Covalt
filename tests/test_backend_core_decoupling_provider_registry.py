from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.services import node_provider_registry as provider_registry
from backend.services.node_provider_registry import _normalize_registration
from backend.services.node_provider_runtime import NodeProviderRuntimeError, NodeProviderRuntimeSpec
from backend.services.plugin_registry import get_executor, list_registered_plugins, unregister_plugin


def _cleanup_external_plugin_state(*plugin_ids: str) -> None:
    provider_registry.clear_node_provider_registry()
    for plugin_id in plugin_ids:
        unregister_plugin(plugin_id)


def _runtime_spec() -> NodeProviderRuntimeSpec:
    return NodeProviderRuntimeSpec(
        plugin_id="sample",
        provider_id="sample",
        plugin_dir=Path("/tmp/sample"),
        entrypoint="runtime.ts",
    )


def test_normalize_registration_uses_plugin_scoped_id_without_np_prefix() -> None:
    registration = _normalize_registration(
        manifest_id="plugin.alpha",
        raw_definition={
            "type": "trigger",
            "name": "Trigger",
            "category": "trigger",
            "icon": "Zap",
            "executionMode": "flow",
            "parameters": [],
            "providerId": "plugin.alpha",
            "pluginId": "plugin.alpha",
        },
        runtime_spec=_runtime_spec(),
    )

    assert registration is not None
    assert registration.node_type == "plugin.alpha:trigger"
    assert not registration.node_type.startswith("np:")


def test_normalize_registration_preserves_explicit_plugin_scoped_type() -> None:
    registration = _normalize_registration(
        manifest_id="plugin.beta",
        raw_definition={
            "type": "plugin.beta:webhook",
            "name": "Webhook",
            "category": "trigger",
            "icon": "Webhook",
            "executionMode": "flow",
            "parameters": [],
            "providerId": "plugin.beta",
            "pluginId": "plugin.beta",
        },
        runtime_spec=_runtime_spec(),
    )

    assert registration is not None
    assert registration.node_type == "plugin.beta:webhook"


def test_reload_node_provider_registry_registers_external_executors_via_plugin_registry(
    monkeypatch,
) -> None:
    _cleanup_external_plugin_state("external.alpha")

    manifest = SimpleNamespace(
        id="external.alpha",
        path=Path("/tmp/external.alpha/node-provider.yaml"),
        runtime_entrypoint="dist/main.ts",
        definitions_source="runtime",
        definitions_file=None,
    )

    monkeypatch.setattr(
        provider_registry,
        "get_node_provider_plugin_manager",
        lambda: SimpleNamespace(get_enabled_manifests=lambda: [manifest]),
    )
    monkeypatch.setattr(
        provider_registry,
        "list_provider_definitions",
        lambda _spec: [
            {
                "type": "trigger",
                "name": "Trigger",
                "category": "trigger",
                "icon": "Zap",
                "executionMode": "flow",
                "parameters": [],
            }
        ],
    )

    try:
        provider_registry.reload_node_provider_registry()

        registration = provider_registry.get_provider_node_registration("external.alpha:trigger")
        assert registration is not None
        assert registration.node_type == "external.alpha:trigger"

        executor = get_executor("external.alpha:trigger")
        assert executor is not None
        assert executor.__class__.__name__ == "ProviderNodeExecutor"
    finally:
        _cleanup_external_plugin_state("external.alpha")


def test_reload_node_provider_registry_unregisters_removed_plugin_executors(monkeypatch) -> None:
    _cleanup_external_plugin_state("external.alpha")

    manifest = SimpleNamespace(
        id="external.alpha",
        path=Path("/tmp/external.alpha/node-provider.yaml"),
        runtime_entrypoint="dist/main.ts",
        definitions_source="runtime",
        definitions_file=None,
    )

    manifests: list[SimpleNamespace] = [manifest]

    monkeypatch.setattr(
        provider_registry,
        "get_node_provider_plugin_manager",
        lambda: SimpleNamespace(get_enabled_manifests=lambda: list(manifests)),
    )
    monkeypatch.setattr(
        provider_registry,
        "list_provider_definitions",
        lambda _spec: [
            {
                "type": "trigger",
                "name": "Trigger",
                "category": "trigger",
                "icon": "Zap",
                "executionMode": "flow",
                "parameters": [],
            }
        ],
    )

    try:
        provider_registry.reload_node_provider_registry()
        assert get_executor("external.alpha:trigger") is not None
        assert provider_registry.get_provider_node_registration("external.alpha:trigger") is not None

        manifests.clear()
        provider_registry.reload_node_provider_registry()

        assert get_executor("external.alpha:trigger") is None
        assert provider_registry.get_provider_node_registration("external.alpha:trigger") is None

        manifests.append(manifest)
        provider_registry.reload_node_provider_registry()

        assert get_executor("external.alpha:trigger") is not None
        assert provider_registry.get_provider_node_registration("external.alpha:trigger") is not None
    finally:
        _cleanup_external_plugin_state("external.alpha")


def test_reload_node_provider_registry_isolates_load_failures_and_keeps_healthy_plugins(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    _cleanup_external_plugin_state("external.ok", "external.bad")

    healthy_manifest = SimpleNamespace(
        id="external.ok",
        path=Path("/tmp/external.ok/node-provider.yaml"),
        runtime_entrypoint="dist/main.ts",
        definitions_source="runtime",
        definitions_file=None,
    )
    failing_manifest = SimpleNamespace(
        id="external.bad",
        path=Path("/tmp/external.bad/node-provider.yaml"),
        runtime_entrypoint="dist/main.ts",
        definitions_source="runtime",
        definitions_file=None,
    )

    monkeypatch.setattr(
        provider_registry,
        "get_node_provider_plugin_manager",
        lambda: SimpleNamespace(get_enabled_manifests=lambda: [healthy_manifest, failing_manifest]),
    )

    def _list_definitions(spec: NodeProviderRuntimeSpec) -> list[dict[str, object]]:
        if spec.plugin_id == "external.bad":
            raise NodeProviderRuntimeError("boom from bad plugin")
        return [
            {
                "type": "trigger",
                "name": "Trigger",
                "category": "trigger",
                "icon": "Zap",
                "executionMode": "flow",
                "parameters": [],
            }
        ]

    monkeypatch.setattr(provider_registry, "list_provider_definitions", _list_definitions)

    try:
        with caplog.at_level("ERROR"):
            provider_registry.reload_node_provider_registry()

        assert get_executor("external.ok:trigger") is not None
        assert provider_registry.get_provider_node_registration("external.ok:trigger") is not None

        assert get_executor("external.bad:trigger") is None
        assert provider_registry.get_provider_node_registration("external.bad:trigger") is None
        assert "external.bad" not in list_registered_plugins()
        assert any("node-provider:external.bad failed loading definitions" in record.message for record in caplog.records)
    finally:
        _cleanup_external_plugin_state("external.ok", "external.bad")
