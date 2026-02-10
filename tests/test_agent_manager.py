from __future__ import annotations

from backend.services.agent_manager import _normalize_graph_edges


def test_normalize_graph_edges_converts_legacy_handles() -> None:
    nodes = [
        {"id": "cs", "type": "chat-start", "data": {}},
        {"id": "a1", "type": "agent", "data": {}},
        {"id": "a2", "type": "agent", "data": {}},
    ]
    edges = [
        {
            "id": "e1",
            "source": "cs",
            "sourceHandle": "agent",
            "target": "a1",
            "targetHandle": "agent",
        },
        {
            "id": "e2",
            "source": "a2",
            "sourceHandle": "agent",
            "target": "a1",
            "targetHandle": "tools",
        },
    ]

    normalized = _normalize_graph_edges(nodes, edges)

    assert normalized[0]["sourceHandle"] == "output"
    assert normalized[0]["targetHandle"] == "input"
    assert normalized[1]["sourceHandle"] == "input"
    assert normalized[1]["targetHandle"] == "tools"


def test_normalize_graph_edges_dedupes_semantic_duplicates() -> None:
    nodes = [
        {"id": "a1", "type": "agent", "data": {}},
        {"id": "a2", "type": "agent", "data": {}},
    ]
    edges = [
        {
            "id": "legacy",
            "source": "a2",
            "sourceHandle": "agent",
            "target": "a1",
            "targetHandle": "tools",
        },
        {
            "id": "modern",
            "source": "a2",
            "sourceHandle": "input",
            "target": "a1",
            "targetHandle": "tools",
        },
    ]

    normalized = _normalize_graph_edges(nodes, edges)

    assert len(normalized) == 1
    assert normalized[0]["source"] == "a2"
    assert normalized[0]["target"] == "a1"
    assert normalized[0]["sourceHandle"] == "input"
    assert normalized[0]["targetHandle"] == "tools"
