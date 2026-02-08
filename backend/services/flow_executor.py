"""Flow execution engine (Phase 2).

Executes flow nodes in topological order, routing DataValues through edges.
Structural nodes (agent/tools wiring) are handled by Phase 1 (graph_executor.py).
This engine handles everything else — data transforms, LLM calls, conditionals, etc.

The algorithm:
  1. Partition graph into structural vs flow subgraphs by edge socket type
  2. Topologically sort flow nodes
  3. For each node: gather inputs from upstream outputs, execute, store outputs
  4. Skip nodes whose required inputs aren't satisfied (dead branches)
  5. Forward NodeEvents to the caller (which routes them to the chat UI)
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, AsyncIterator

from nodes._types import DataValue, ExecutionResult, FlowContext, NodeEvent

logger = logging.getLogger(__name__)

STRUCTURAL_SOCKET_TYPES = {"agent", "tools"}


# ── Graph partitioning ──────────────────────────────────────────────


def partition_graph(
    nodes: list[dict], edges: list[dict]
) -> tuple[list[dict], list[dict]]:
    """Separate nodes into structural and flow subgraphs by edge socket type.

    Structural edges connect agent/tools sockets. Everything else is flow.
    Hybrid nodes (like Agent with both structural and flow edges) appear in both.
    """
    structural_ids: set[str] = set()
    flow_ids: set[str] = set()

    for edge in edges:
        source_handle = edge.get("sourceHandle", "")
        target_handle = edge.get("targetHandle", "")

        is_structural = (
            source_handle in STRUCTURAL_SOCKET_TYPES
            or target_handle in STRUCTURAL_SOCKET_TYPES
        )
        if is_structural:
            structural_ids.add(edge["source"])
            structural_ids.add(edge["target"])
        else:
            flow_ids.add(edge["source"])
            flow_ids.add(edge["target"])

    nodes_by_id = {n["id"]: n for n in nodes}
    structural = [nodes_by_id[nid] for nid in structural_ids if nid in nodes_by_id]
    flow = [nodes_by_id[nid] for nid in flow_ids if nid in nodes_by_id]

    return structural, flow


# ── Topological sort ────────────────────────────────────────────────


def topological_sort(nodes: list[dict], edges: list[dict]) -> list[str]:
    """Kahn's algorithm. Returns node IDs in execution order. Raises on cycles."""
    node_ids = {n["id"] for n in nodes}
    in_degree: dict[str, int] = {nid: 0 for nid in node_ids}
    adjacency: dict[str, list[str]] = {nid: [] for nid in node_ids}

    for edge in edges:
        src, tgt = edge["source"], edge["target"]
        if src in node_ids and tgt in node_ids:
            adjacency[src].append(tgt)
            in_degree[tgt] += 1

    # Sorted for deterministic ordering
    queue = sorted(nid for nid in node_ids if in_degree[nid] == 0)
    result: list[str] = []

    while queue:
        node = queue.pop(0)
        result.append(node)
        for neighbor in sorted(adjacency[node]):
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)
                queue.sort()

    if len(result) != len(node_ids):
        raise ValueError("Cycle detected in flow graph")

    return result


# ── Flow edge helpers ───────────────────────────────────────────────


def _flow_edges(edges: list[dict]) -> list[dict]:
    """Filter to only flow (non-structural) edges."""
    return [
        e
        for e in edges
        if e.get("sourceHandle", "") not in STRUCTURAL_SOCKET_TYPES
        and e.get("targetHandle", "") not in STRUCTURAL_SOCKET_TYPES
    ]


def _gather_inputs(
    node_id: str,
    edges: list[dict],
    port_values: dict[str, dict[str, DataValue]],
) -> dict[str, DataValue]:
    """Pull DataValues from upstream output ports into this node's input ports."""
    inputs: dict[str, DataValue] = {}
    for edge in edges:
        if edge["target"] != node_id:
            continue
        source_outputs = port_values.get(edge["source"], {})
        value = source_outputs.get(edge.get("sourceHandle", "output"))
        if value is not None:
            inputs[edge.get("targetHandle", "input")] = value
    return inputs


def _has_incoming_edges(node_id: str, edges: list[dict]) -> bool:
    return any(e["target"] == node_id for e in edges)


# ── Main engine ─────────────────────────────────────────────────────


async def run_flow(
    graph_data: dict[str, Any],
    agent: Any | None,
    context: Any,
    executors: dict[str, Any] | None = None,
) -> AsyncIterator[NodeEvent | ExecutionResult]:
    """Execute flow nodes in topological order, yielding events and results.

    Args:
        graph_data: The full graph JSON (nodes + edges).
        agent: Agent/Team built in Phase 1 (available to hybrid nodes).
        context: Outer context with run_id, state (user_message), etc.
        executors: Optional executor map for testing (bypasses auto-discovery).

    Yields:
        NodeEvent for UI updates, ExecutionResult for node outputs.
    """
    nodes_list = graph_data.get("nodes", [])
    edges = graph_data.get("edges", [])

    _, flow_nodes = partition_graph(nodes_list, edges)
    if not flow_nodes:
        return

    flow_edge_list = _flow_edges(edges)
    order = topological_sort(flow_nodes, flow_edge_list)

    run_id = getattr(context, "run_id", str(uuid.uuid4()))
    state = getattr(context, "state", None)

    # node_id -> {port_name: DataValue}
    port_values: dict[str, dict[str, DataValue]] = {}
    nodes_by_id = {n["id"]: n for n in flow_nodes}

    for node_id in order:
        node = nodes_by_id.get(node_id)
        if node is None:
            continue

        node_type = node.get("type", "")
        data = node.get("data", {})

        # Look up executor
        executor = _get_executor(node_type, executors)
        if executor is None or not hasattr(executor, "execute"):
            if executor is None:
                logger.warning(f"No executor for flow node type: {node_type}")
            else:
                logger.warning(f"Executor for '{node_type}' has no execute() method")
            continue

        # Gather inputs from upstream edges
        inputs = _gather_inputs(node_id, flow_edge_list, port_values)

        # Dead branch detection: has incoming edges but none produced data → skip
        if _has_incoming_edges(node_id, flow_edge_list) and not inputs:
            continue

        # Create per-node FlowContext
        node_context = FlowContext(
            node_id=node_id,
            chat_id=getattr(context, "chat_id", None),
            run_id=run_id,
            state=state,
            agent=agent,
            tool_registry=getattr(context, "tool_registry", None),
        )

        # Execute
        on_error = data.get("on_error", "stop")
        try:
            async for item in _run_executor(
                executor, data, inputs, node_context, run_id
            ):
                yield item
                if isinstance(item, ExecutionResult):
                    port_values[node_id] = item.outputs
        except Exception as e:
            yield NodeEvent(
                node_id=node_id,
                node_type=node_type,
                event_type="error",
                run_id=run_id,
                data={"error": str(e)},
            )
            if on_error == "continue":
                port_values[node_id] = {
                    "output": DataValue(type="error", value={"error": str(e)})
                }
            else:
                return


def _get_executor(node_type: str, executors: dict[str, Any] | None) -> Any | None:
    """Look up executor from test map or auto-discovery registry."""
    if executors:
        return executors.get(node_type)
    from nodes import get_executor

    return get_executor(node_type)


async def _run_executor(
    executor: Any,
    data: dict[str, Any],
    inputs: dict[str, DataValue],
    context: FlowContext,
    run_id: str,
) -> AsyncIterator[NodeEvent | ExecutionResult]:
    """Call executor.execute(), handling both sync (coroutine) and streaming (async gen)."""
    result = executor.execute(data, inputs, context)

    if hasattr(result, "__aiter__"):
        # Streaming executor — yields NodeEvent/ExecutionResult directly
        async for item in result:
            yield item
    else:
        # Sync executor — returns ExecutionResult via coroutine
        execution_result = await result
        if isinstance(execution_result, ExecutionResult):
            yield NodeEvent(
                node_id=context.node_id,
                node_type=executor.node_type,
                event_type="started",
                run_id=run_id,
            )
            yield execution_result
            yield NodeEvent(
                node_id=context.node_id,
                node_type=executor.node_type,
                event_type="completed",
                run_id=run_id,
            )


# ── Utilities for streaming.py integration ──────────────────────────


def has_flow_nodes(graph_data: dict[str, Any]) -> bool:
    """Quick check: does this graph have any flow (non-structural) nodes?"""
    nodes = graph_data.get("nodes", [])
    edges = graph_data.get("edges", [])
    _, flow = partition_graph(nodes, edges)
    return len(flow) > 0
