from __future__ import annotations

from backend.services import node_plugin_catalog as catalog
from backend.services.node_plugin_catalog import NodeDefinitionRecord


def test_list_node_plugins_marks_coherent_when_runtime_and_definition_match(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        catalog,
        "build_node_definition_records",
        lambda: [
            NodeDefinitionRecord(
                node_type="agent",
                definition_module="nodes/core/agent/definition.ts",
                definition_path="/tmp/nodes/core/agent/definition.ts",
                node_id="agent",
                name="Agent",
                category="core",
                execution_mode="single",
            )
        ],
    )

    monkeypatch.setattr(
        "nodes.list_node_plugin_metadata",
        lambda: [
            {
                "node_type": "agent",
                "module_path": "nodes.core.agent.executor",
                "has_execute": True,
                "has_materialize": True,
                "has_configure_runtime": False,
                "has_init_routes": False,
            }
        ],
    )

    plugins = catalog.list_node_plugins()

    assert len(plugins) == 1
    assert plugins[0]["node_type"] == "agent"
    assert plugins[0]["coherent"] is True


def test_list_node_plugins_marks_incoherent_for_mismatched_node_id(monkeypatch) -> None:
    monkeypatch.setattr(
        catalog,
        "build_node_definition_records",
        lambda: [
            NodeDefinitionRecord(
                node_type="agent",
                definition_module="nodes/core/agent/definition.ts",
                definition_path="/tmp/nodes/core/agent/definition.ts",
                node_id="agent-v2",
                name="Agent",
                category="core",
                execution_mode="single",
            )
        ],
    )

    monkeypatch.setattr(
        "nodes.list_node_plugin_metadata",
        lambda: [
            {
                "node_type": "agent",
                "module_path": "nodes.core.agent.executor",
                "has_execute": True,
            }
        ],
    )

    plugins = catalog.list_node_plugins()

    assert plugins[0]["coherent"] is False


def test_list_node_plugins_includes_runtime_only_and_definition_only(monkeypatch) -> None:
    monkeypatch.setattr(
        catalog,
        "build_node_definition_records",
        lambda: [
            NodeDefinitionRecord(
                node_type="definition-only",
                definition_module="nodes/custom/definition_only/definition.ts",
                definition_path="/tmp/nodes/custom/definition_only/definition.ts",
                node_id="definition-only",
                name="Definition Only",
                category="custom",
                execution_mode="single",
            )
        ],
    )

    monkeypatch.setattr(
        "nodes.list_node_plugin_metadata",
        lambda: [
            {
                "node_type": "runtime-only",
                "module_path": "nodes.custom.runtime_only.executor",
                "has_execute": True,
            }
        ],
    )

    plugins = catalog.list_node_plugins()
    by_type = {item["node_type"]: item for item in plugins}

    assert set(by_type) == {"definition-only", "runtime-only"}
    assert by_type["definition-only"]["runtime"]["module_path"] is None
    assert by_type["definition-only"]["coherent"] is False
    assert by_type["runtime-only"]["definition"]["module_path"] is None
    assert by_type["runtime-only"]["coherent"] is False
