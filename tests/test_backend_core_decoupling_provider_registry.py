from __future__ import annotations

from pathlib import Path

from backend.services.node_provider_registry import _normalize_registration
from backend.services.node_provider_runtime import NodeProviderRuntimeSpec


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
