from __future__ import annotations

from backend.commands.agents import GraphEdge


def test_graph_edge_data_payload_round_trips() -> None:
    edge = GraphEdge(
        id="e1",
        source="a1",
        sourceHandle="output",
        target="a2",
        targetHandle="input",
        data={
            "sourceType": "data",
            "targetType": "data",
            "channel": "flow",
            "custom": "kept",
        },
    )

    payload = edge.model_dump(exclude_none=True)

    assert payload["data"]["sourceType"] == "data"
    assert payload["data"]["targetType"] == "data"
    assert payload["data"]["channel"] == "flow"
    assert payload["data"]["custom"] == "kept"
