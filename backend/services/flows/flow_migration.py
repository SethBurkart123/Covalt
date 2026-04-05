from __future__ import annotations

from typing import Any

LEGACY_NODE_TYPE_ALIASES: dict[str, str] = {
    "chat_start": "chat-start",
    "webhook_trigger": "webhook-trigger",
    "webhook_end": "webhook-end",
    "llm_completion": "llm-completion",
    "prompt_template": "prompt-template",
    "mcp_server": "mcp-server",
    "model_selector": "model-selector",
}


def migrate_node_type(node_type: str) -> str:
    normalized = node_type.strip()
    if normalized.startswith("np:"):
        normalized = normalized[3:]
    return LEGACY_NODE_TYPE_ALIASES.get(normalized, normalized)


def _infer_edge_channel(edge: dict[str, Any]) -> str:
    source_handle = edge.get("sourceHandle")
    target_handle = edge.get("targetHandle")
    if source_handle == "tools" or target_handle == "tools":
        return "link"
    return "flow"


def migrate_graph_nodes(
    nodes: list[Any],
) -> list[dict[str, Any]]:
    migrated: list[dict[str, Any]] = []

    for raw_node in nodes:
        if not isinstance(raw_node, dict):
            continue

        node = dict(raw_node)
        node_type = node.get("type")
        if isinstance(node_type, str):
            node["type"] = migrate_node_type(node_type)

        data = node.get("data")
        node["data"] = dict(data) if isinstance(data, dict) else {}
        migrated.append(node)

    return migrated


def migrate_graph_edges(edges: list[Any]) -> list[dict[str, Any]]:
    migrated: list[dict[str, Any]] = []

    for raw_edge in edges:
        if not isinstance(raw_edge, dict):
            continue

        edge = dict(raw_edge)
        data = edge.get("data")
        edge_data = dict(data) if isinstance(data, dict) else {}

        channel = edge_data.get("channel")
        if channel not in {"flow", "link"}:
            edge_data["channel"] = _infer_edge_channel(edge)

        edge["data"] = edge_data
        migrated.append(edge)

    return migrated


def requires_graph_migration(graph_data: dict[str, Any] | None) -> bool:
    if not isinstance(graph_data, dict):
        return False

    raw_nodes = graph_data.get("nodes")
    if not isinstance(raw_nodes, list):
        return False

    for raw_node in raw_nodes:
        if not isinstance(raw_node, dict):
            continue
        node_type = raw_node.get("type")
        if not isinstance(node_type, str):
            continue
        if migrate_node_type(node_type) != node_type:
            return True

    return False


def migrate_graph_data(graph_data: dict[str, Any] | None) -> dict[str, list[dict[str, Any]]]:
    if not isinstance(graph_data, dict):
        return {"nodes": [], "edges": []}

    raw_nodes = graph_data.get("nodes")
    raw_edges = graph_data.get("edges")

    return {
        "nodes": migrate_graph_nodes(raw_nodes if isinstance(raw_nodes, list) else []),
        "edges": migrate_graph_edges(raw_edges if isinstance(raw_edges, list) else []),
    }
