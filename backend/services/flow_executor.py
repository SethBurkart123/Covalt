"""Flow execution engine (Phase 2).

Executes flow nodes in topological order, routing DataValues through edges.
Structural composition (agent/tools wiring) is handled in node build capabilities.
This engine handles runtime data flow — transforms, LLM calls, conditionals, agents in
pipeline mode, etc.

The algorithm:
  1. Find flow-capable nodes (executors with an execute() method)
  2. Filter to flow edges (non-structural) for data routing
  3. Topologically sort flow nodes by flow edges
  4. For each node: gather inputs (with type coercion), execute, store outputs
  5. Skip nodes whose required inputs aren't satisfied (dead branches)
  6. Forward NodeEvents to the caller (which routes them to the chat UI)

Node partitioning is based on executor capabilities, NOT socket types:
  - Has build()    → structural (Phase 1)
  - Has execute()  → flow (Phase 2)
  - Has both       → hybrid (both phases)

Edge partitioning is channel-based (`edge.data.channel`):
  - `flow` carries runtime data
  - `link` carries structural composition
"""

from __future__ import annotations

import logging
import uuid
from collections import deque
from typing import Any, AsyncIterator

from nodes._coerce import coerce
from nodes._expressions import resolve_expressions
from nodes._types import DataValue, ExecutionResult, FlowContext, NodeEvent

logger = logging.getLogger(__name__)

FLOW_EDGE_CHANNEL = "flow"


# ── Node partitioning ────────────────────────────────────────────────


def _is_flow_capable(node_type: str, executors: dict[str, Any] | None) -> bool:
    """Check if a node type has an executor with an execute() method."""
    executor = _get_executor(node_type, executors)
    return executor is not None and hasattr(executor, "execute")


def find_flow_nodes(
    nodes: list[dict], executors: dict[str, Any] | None = None
) -> list[dict]:
    """Return nodes whose executors have an execute() method."""
    return [n for n in nodes if _is_flow_capable(n.get("type", ""), executors)]


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


# ── Edge helpers ─────────────────────────────────────────────────────


def _flow_edges(edges: list[dict]) -> list[dict]:
    """Filter to edges that carry runtime data (channel=flow)."""

    flow_edges: list[dict] = []
    for edge in edges:
        data = edge.get("data")
        if not isinstance(data, dict):
            raise ValueError(
                f"Edge '{edge.get('id', '<unknown>')}' missing data payload"
            )

        channel = data.get("channel")
        if channel == FLOW_EDGE_CHANNEL:
            flow_edges.append(edge)
            continue
        if channel == "link":
            continue

        raise ValueError(
            f"Edge '{edge.get('id', '<unknown>')}' has invalid channel: {channel!r}"
        )

    return flow_edges


def _select_active_flow_subgraph(
    flow_nodes: list[dict], flow_edges: list[dict]
) -> tuple[list[dict], list[dict]]:
    """Restrict execution to the flow component(s) reachable from Chat Start.

    This prevents structurally-connected nodes (e.g., sub-agents attached as tools)
    from executing as independent flow roots when they have no flow edges.

    If no Chat Start node exists, keep the full flow subgraph unchanged.
    """
    node_ids = {n["id"] for n in flow_nodes}
    chat_start_ids = {n["id"] for n in flow_nodes if n.get("type", "") == "chat-start"}

    if not chat_start_ids:
        return flow_nodes, flow_edges

    adjacency: dict[str, set[str]] = {nid: set() for nid in node_ids}
    for edge in flow_edges:
        src = edge.get("source")
        tgt = edge.get("target")
        if src in node_ids and tgt in node_ids:
            adjacency[src].add(tgt)
            adjacency[tgt].add(src)

    active_ids: set[str] = set()
    queue: deque[str] = deque(chat_start_ids)
    while queue:
        nid = queue.popleft()
        if nid in active_ids:
            continue
        active_ids.add(nid)
        for neighbor in adjacency.get(nid, set()):
            if neighbor not in active_ids:
                queue.append(neighbor)

    active_nodes = [n for n in flow_nodes if n["id"] in active_ids]
    active_edges = [
        e
        for e in flow_edges
        if e.get("source") in active_ids and e.get("target") in active_ids
    ]
    return active_nodes, active_edges


def _gather_inputs(
    node_id: str,
    edges: list[dict],
    port_values: dict[str, dict[str, DataValue]],
) -> dict[str, DataValue]:
    """Pull DataValues from upstream output ports, applying type coercion."""
    inputs: dict[str, DataValue] = {}
    for edge in edges:
        if edge["target"] != node_id:
            continue
        source_outputs = port_values.get(edge["source"], {})
        value = source_outputs.get(edge.get("sourceHandle", "output"))
        if value is None:
            continue

        # Coerce ONLY for typed side socket edges (not data spine)
        target_type = (edge.get("data") or {}).get("targetType")
        if (
            target_type
            and target_type != "data"
            and value.type != "data"
            and value.type != target_type
        ):
            try:
                value = coerce(value, target_type)
            except TypeError:
                pass

        inputs[edge.get("targetHandle", "input")] = value
    return inputs


def _has_incoming_edges(node_id: str, edges: list[dict]) -> bool:
    return any(e["target"] == node_id for e in edges)


# ── Main engine ─────────────────────────────────────────────────────


def _get_node_label(node: dict) -> str:
    """Get display label for expression resolution."""
    return (
        node.get("data", {}).get("_label")
        or node.get("data", {}).get("label")
        or node.get("id", "")
    )


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

    flow_nodes = find_flow_nodes(nodes_list, executors)
    if not flow_nodes:
        return

    flow_edge_list = _flow_edges(edges)
    active_flow_nodes, active_flow_edges = _select_active_flow_subgraph(
        flow_nodes, flow_edge_list
    )
    if not active_flow_nodes:
        return

    order = topological_sort(active_flow_nodes, active_flow_edges)

    run_id = getattr(context, "run_id", str(uuid.uuid4()))
    state = getattr(context, "state", None)

    port_values: dict[str, dict[str, DataValue]] = {}
    upstream_outputs: dict[str, Any] = {}
    label_sources: dict[str, str] = {}
    nodes_by_id = {n["id"]: n for n in active_flow_nodes}

    for node_id in order:
        node = nodes_by_id.get(node_id)
        if node is None:
            continue

        node_type = node.get("type", "")
        data = node.get("data", {})

        executor = _get_executor(node_type, executors)
        if executor is None or not hasattr(executor, "execute"):
            continue

        inputs = _gather_inputs(node_id, active_flow_edges, port_values)

        # Dead branch detection: has incoming flow edges but none produced data
        if _has_incoming_edges(node_id, active_flow_edges) and not inputs:
            continue

        direct_input = inputs.get("input")
        data = resolve_expressions(data, direct_input, upstream_outputs)

        node_context = FlowContext(
            node_id=node_id,
            chat_id=getattr(context, "chat_id", None),
            run_id=run_id,
            state=state,
            agent=agent,
            tool_registry=getattr(context, "tool_registry", None),
        )

        on_error = data.get("on_error", "stop")
        try:
            async for item in _run_executor(
                executor, data, inputs, node_context, run_id
            ):
                yield item
                if isinstance(item, ExecutionResult):
                    port_values[node_id] = item.outputs
                    # Populate upstream outputs for $() expressions
                    label = _get_node_label(node)
                    data_output = (
                        item.outputs.get("output")
                        or item.outputs.get("true")
                        or item.outputs.get("false")
                    )
                    if data_output is not None:
                        upstream_outputs[node_id] = data_output.value
                        prior_node_id = label_sources.get(label)
                        if prior_node_id and prior_node_id != node_id:
                            logger.warning(
                                "Duplicate node label '%s' seen on %s and %s; "
                                "label-based expressions may be ambiguous",
                                label,
                                prior_node_id,
                                node_id,
                            )
                        label_sources[label] = node_id
                        upstream_outputs[label] = data_output.value
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
        async for item in result:
            yield item
    else:
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
