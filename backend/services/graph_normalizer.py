from __future__ import annotations

from typing import Any, Literal

EdgeChannel = Literal["flow", "link"]

VALID_EDGE_CHANNELS: set[str] = {"flow", "link"}


def _require_edge_channel(edge: dict[str, Any]) -> EdgeChannel:
    data = edge.get("data")
    if not isinstance(data, dict):
        raise ValueError(f"Edge '{edge.get('id', '<unknown>')}' missing data payload")

    channel = data.get("channel")
    if channel not in VALID_EDGE_CHANNELS:
        raise ValueError(
            f"Edge '{edge.get('id', '<unknown>')}' has invalid channel: {channel!r}"
        )

    return channel


def normalize_graph_edges(
    nodes: list[dict[str, Any]], edges: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Normalize graph edges and dedupe exact channel-aware duplicates."""
    del nodes

    normalized: list[dict[str, Any]] = []
    seen_signatures: set[tuple[str, str, str, str, EdgeChannel]] = set()

    for edge in edges:
        source = edge.get("source")
        target = edge.get("target")
        source_handle = edge.get("sourceHandle")
        target_handle = edge.get("targetHandle")

        if not source or not target:
            continue

        edge_data = edge.get("data")
        normalized_data: dict[str, Any]
        if isinstance(edge_data, dict):
            normalized_data = dict(edge_data)
        else:
            normalized_data = {}

        channel = _require_edge_channel(
            {
                **edge,
                "data": normalized_data,
            }
        )

        signature = (
            source,
            target,
            source_handle or "",
            target_handle or "",
            channel,
        )
        if signature in seen_signatures:
            continue
        seen_signatures.add(signature)

        normalized.append(
            {
                **edge,
                "sourceHandle": source_handle,
                "targetHandle": target_handle,
                "data": normalized_data,
            }
        )

    return normalized


def normalize_graph_data(
    nodes: list[dict[str, Any]], edges: list[dict[str, Any]]
) -> dict[str, list[dict[str, Any]]]:
    """Normalize graph payload at save/load boundaries."""
    normalized_nodes = [dict(node) for node in nodes if isinstance(node, dict)]
    normalized_edge_inputs = [dict(edge) for edge in edges if isinstance(edge, dict)]
    normalized_edges = normalize_graph_edges(normalized_nodes, normalized_edge_inputs)
    return {"nodes": normalized_nodes, "edges": normalized_edges}
