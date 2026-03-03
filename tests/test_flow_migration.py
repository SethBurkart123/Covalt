from __future__ import annotations

from backend.services.flow_migration import migrate_graph_data, migrate_node_type


def test_migrate_node_type_removes_np_prefix_and_maps_legacy_aliases() -> None:
    assert migrate_node_type("np:chat_start") == "chat-start"
    assert migrate_node_type("webhook_end") == "webhook-end"
    assert migrate_node_type("plugin.alpha:trigger") == "plugin.alpha:trigger"


def test_migrate_graph_data_normalizes_legacy_nodes_and_edge_channels() -> None:
    migrated = migrate_graph_data(
        {
            "nodes": [
                {
                    "id": "entry",
                    "type": "chat_start",
                    "position": {"x": 0, "y": 0},
                    "data": None,
                },
                {
                    "id": "provider",
                    "type": "np:external.alpha:trigger",
                    "position": {"x": 100, "y": 0},
                    "data": {"hookId": "hook-1"},
                },
            ],
            "edges": [
                {
                    "id": "e-flow",
                    "source": "entry",
                    "sourceHandle": "output",
                    "target": "provider",
                    "targetHandle": "input",
                    "data": {"sourceType": "data"},
                },
                {
                    "id": "e-link",
                    "source": "provider",
                    "sourceHandle": "tools",
                    "target": "entry",
                    "targetHandle": "tools",
                    "data": {},
                },
            ],
        }
    )

    assert migrated["nodes"][0]["type"] == "chat-start"
    assert migrated["nodes"][0]["data"] == {}
    assert migrated["nodes"][1]["type"] == "external.alpha:trigger"

    by_id = {edge["id"]: edge for edge in migrated["edges"]}
    assert by_id["e-flow"]["data"]["channel"] == "flow"
    assert by_id["e-link"]["data"]["channel"] == "link"


def test_migrate_graph_data_ignores_non_dict_entries() -> None:
    migrated = migrate_graph_data(
        {
            "nodes": ["bad", {"id": "n1", "type": "agent", "data": {}}],
            "edges": [None, {"id": "e1", "source": "n1", "target": "n1", "data": {"channel": "flow"}}],
        }
    )

    assert len(migrated["nodes"]) == 1
    assert migrated["nodes"][0]["id"] == "n1"
    assert len(migrated["edges"]) == 1
    assert migrated["edges"][0]["id"] == "e1"
