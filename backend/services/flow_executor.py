"""Flow execution engine (Phase 2).

Executes flow nodes in topological order, routing DataValues through edges.
Structural composition (agent/tools wiring) is resolved via runtime materialization.
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
  - Has execute()  → flow (Phase 2)

Edge partitioning is channel-based (`edge.data.channel`):
  - `flow` carries runtime data
  - `link` carries structural composition
"""

from __future__ import annotations

import logging
import types
import uuid
from typing import Any, AsyncIterator

from backend.services.graph_runtime import GraphRuntime
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


def _normalize_cached_value(value: Any) -> DataValue:
    if isinstance(value, DataValue):
        return value
    if isinstance(value, dict):
        raw_type = value.get("type")
        if isinstance(raw_type, str):
            return DataValue(type=raw_type, value=value.get("value"))
        if "value" in value:
            return DataValue(type="data", value=value.get("value"))
    return DataValue(type="data", value=value)


def _normalize_cached_outputs(raw: Any) -> dict[str, dict[str, DataValue]]:
    if not isinstance(raw, dict):
        return {}

    normalized: dict[str, dict[str, DataValue]] = {}
    for node_id, outputs in raw.items():
        if not isinstance(node_id, str) or not node_id:
            continue
        if not isinstance(outputs, dict):
            continue
        coerced_outputs: dict[str, DataValue] = {}
        for handle, value in outputs.items():
            if not isinstance(handle, str) or not handle:
                continue
            coerced_outputs[handle] = _normalize_cached_value(value)
        if coerced_outputs:
            normalized[node_id] = coerced_outputs
    return normalized


def _gather_inputs(
    node_id: str,
    runtime: GraphRuntime,
    port_values: dict[str, dict[str, DataValue]],
) -> dict[str, DataValue]:
    """Pull DataValues from upstream output ports, applying type coercion."""
    inputs: dict[str, DataValue] = {}
    for edge in runtime.incoming_edges(node_id, channel=FLOW_EDGE_CHANNEL):
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
            value = coerce(value, target_type)

        inputs[edge.get("targetHandle", "input")] = value
    return inputs


def _has_incoming_edges(node_id: str, edges: list[dict]) -> bool:
    return len(edges) > 0


def _execution_entry_node_ids(services: Any) -> set[str] | None:
    execution = getattr(services, "execution", None)
    if execution is None:
        return None

    raw_entry_node_ids = getattr(execution, "entry_node_ids", None)
    if not isinstance(raw_entry_node_ids, (list, tuple, set)):
        return None

    entry_node_ids = {
        str(node_id)
        for node_id in raw_entry_node_ids
        if isinstance(node_id, str) and node_id
    }
    return entry_node_ids or None


def _reachable_nodes_from_entries(
    edges: list[dict],
    entry_node_ids: set[str],
) -> set[str]:
    if not entry_node_ids:
        return set()

    adjacency: dict[str, list[str]] = {}
    for edge in edges:
        source = edge.get("source")
        target = edge.get("target")
        if not source or not target:
            continue
        adjacency.setdefault(source, []).append(target)

    visited: set[str] = set()
    queue: list[str] = sorted(entry_node_ids)

    while queue:
        node_id = queue.pop(0)
        if node_id in visited:
            continue
        visited.add(node_id)

        for target_id in adjacency.get(node_id, []):
            if target_id not in visited:
                queue.append(target_id)

    return visited


def _upstream_closure(edges: list[dict], seed_node_ids: set[str]) -> set[str]:
    if not seed_node_ids:
        return set()

    reverse_adjacency: dict[str, list[str]] = {}
    for edge in edges:
        source = edge.get("source")
        target = edge.get("target")
        if not source or not target:
            continue
        reverse_adjacency.setdefault(target, []).append(source)

    visited: set[str] = set()
    queue: list[str] = sorted(seed_node_ids)

    while queue:
        node_id = queue.pop(0)
        if node_id in visited:
            continue
        visited.add(node_id)

        for source_id in reverse_adjacency.get(node_id, []):
            if source_id not in visited:
                queue.append(source_id)

    return visited


def _filter_flow_subgraph(
    flow_nodes: list[dict],
    flow_edges: list[dict],
    entry_node_ids: set[str],
) -> tuple[list[dict], list[dict]]:
    downstream_ids = _reachable_nodes_from_entries(flow_edges, entry_node_ids)
    if not downstream_ids:
        return [], []

    scoped_node_ids = downstream_ids | _upstream_closure(flow_edges, downstream_ids)

    scoped_nodes = [node for node in flow_nodes if node.get("id") in scoped_node_ids]
    scoped_node_ids = {node["id"] for node in scoped_nodes if node.get("id")}

    scoped_edges = [
        edge
        for edge in flow_edges
        if edge.get("source") in scoped_node_ids
        and edge.get("target") in scoped_node_ids
    ]
    return scoped_nodes, scoped_edges


def _execution_scope(services: Any) -> tuple[str | None, set[str], set[str] | None]:
    execution = getattr(services, "execution", None)
    if execution is None:
        return None, set(), None

    scope = getattr(execution, "scope", None)
    if scope is None:
        return None, set(), None

    mode: str | None = None
    targets: list[str] = []
    explicit_nodes: list[str] = []
    explicit_nodes_present = False

    if isinstance(scope, dict):
        raw_mode = scope.get("mode")
        if isinstance(raw_mode, str):
            mode = raw_mode

        raw_targets = scope.get("target_node_ids") or scope.get("targetNodeIds")
        if raw_targets is None:
            raw_targets = scope.get("target_node_id") or scope.get("targetNodeId")

        if isinstance(raw_targets, str):
            targets = [raw_targets]
        elif isinstance(raw_targets, (list, tuple, set)):
            targets = [str(t) for t in raw_targets if isinstance(t, str) and t]

        raw_nodes = scope.get("node_ids") or scope.get("nodeIds")
        if isinstance(raw_nodes, str):
            explicit_nodes_present = True
            explicit_nodes = [raw_nodes]
        elif isinstance(raw_nodes, (list, tuple, set)):
            explicit_nodes_present = True
            explicit_nodes = [str(t) for t in raw_nodes if isinstance(t, str) and t]

    explicit_set = set(explicit_nodes) if explicit_nodes_present else None
    return mode, set(targets), explicit_set


def _apply_execution_scope(
    flow_nodes: list[dict],
    flow_edges: list[dict],
    mode: str,
    target_node_ids: set[str],
) -> tuple[list[dict], list[dict]]:
    if not target_node_ids:
        return [], []

    node_ids = {node.get("id") for node in flow_nodes if node.get("id")}
    scoped_targets = {nid for nid in target_node_ids if nid in node_ids}
    if not scoped_targets:
        return [], []

    if mode == "execute":
        scoped_node_ids = _upstream_closure(flow_edges, scoped_targets)
    elif mode == "runFrom":
        scoped_node_ids = _reachable_nodes_from_entries(flow_edges, scoped_targets)
    else:
        return flow_nodes, flow_edges

    scoped_nodes = [node for node in flow_nodes if node.get("id") in scoped_node_ids]
    scoped_node_ids = {node.get("id") for node in scoped_nodes if node.get("id")}
    scoped_edges = [
        edge
        for edge in flow_edges
        if edge.get("source") in scoped_node_ids
        and edge.get("target") in scoped_node_ids
    ]
    return scoped_nodes, scoped_edges


def _apply_explicit_scope(
    flow_nodes: list[dict],
    flow_edges: list[dict],
    explicit_node_ids: set[str],
) -> tuple[list[dict], list[dict]]:
    if not explicit_node_ids:
        return [], []

    node_ids = {node.get("id") for node in flow_nodes if node.get("id")}
    scoped_node_ids = {nid for nid in explicit_node_ids if nid in node_ids}
    if not scoped_node_ids:
        return [], []

    scoped_nodes = [node for node in flow_nodes if node.get("id") in scoped_node_ids]
    scoped_node_ids = {node.get("id") for node in scoped_nodes if node.get("id")}
    scoped_edges = [
        edge
        for edge in flow_edges
        if edge.get("source") in scoped_node_ids
        and edge.get("target") in scoped_node_ids
    ]
    return scoped_nodes, scoped_edges


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
    context: Any,
    executors: dict[str, Any] | None = None,
) -> AsyncIterator[NodeEvent | ExecutionResult]:
    """Execute flow nodes in topological order, yielding events and results.

    Args:
        graph_data: The full graph JSON (nodes + edges).
        context: Outer context with run_id, state (user_message), etc.
        executors: Optional executor map for testing (bypasses auto-discovery).

    Yields:
        NodeEvent for UI updates, ExecutionResult for node outputs.
    """
    nodes_list = graph_data.get("nodes", [])
    edges = graph_data.get("edges", [])

    run_id = getattr(context, "run_id", str(uuid.uuid4()))
    chat_id = getattr(context, "chat_id", None)
    state = getattr(context, "state", None)
    services = getattr(context, "services", None) or types.SimpleNamespace()

    flow_nodes = find_flow_nodes(nodes_list, executors)
    if not flow_nodes:
        return

    flow_edge_list = _flow_edges(edges)
    scoped_entry_node_ids = _execution_entry_node_ids(services)
    if scoped_entry_node_ids is not None:
        flow_nodes, flow_edge_list = _filter_flow_subgraph(
            flow_nodes,
            flow_edge_list,
            scoped_entry_node_ids,
        )
        if not flow_nodes:
            return

    scope_mode, scope_targets, explicit_scope_nodes = _execution_scope(services)
    if explicit_scope_nodes is not None:
        flow_nodes, flow_edge_list = _apply_explicit_scope(
            flow_nodes,
            flow_edge_list,
            explicit_scope_nodes,
        )
        if not flow_nodes:
            return
    elif scope_mode is not None:
        flow_nodes, flow_edge_list = _apply_execution_scope(
            flow_nodes,
            flow_edge_list,
            scope_mode,
            scope_targets,
        )
        if not flow_nodes:
            return

    execution_ctx = getattr(services, "execution", None)
    cached_raw = None
    if execution_ctx is not None:
        cached_raw = getattr(execution_ctx, "cached_outputs", None)
        if cached_raw is None:
            cached_raw = getattr(execution_ctx, "cachedOutputs", None)
    cached_outputs = _normalize_cached_outputs(cached_raw)

    order = topological_sort(flow_nodes, flow_edge_list)

    runtime = GraphRuntime(
        graph_data,
        run_id=run_id,
        chat_id=chat_id,
        state=state,
        services=services,
        executors=executors,
    )

    port_values: dict[str, dict[str, DataValue]] = {}
    upstream_outputs: dict[str, Any] = {}
    label_sources: dict[str, str] = {}
    nodes_by_id = {n["id"]: n for n in flow_nodes}
    nodes_by_id_all = {n.get("id"): n for n in nodes_list if isinstance(n, dict)}
    if services is not None:
        try:
            setattr(services, "upstream_outputs", upstream_outputs)
        except Exception:
            pass

    if cached_outputs:
        for cached_node_id, outputs in cached_outputs.items():
            port_values[cached_node_id] = outputs
            node = nodes_by_id_all.get(cached_node_id)
            if node is None:
                continue
            label = _get_node_label(node)
            data_output = (
                outputs.get("output")
                or outputs.get("true")
                or outputs.get("false")
            )
            if data_output is not None:
                upstream_outputs[cached_node_id] = data_output.value
                prior_node_id = label_sources.get(label)
                if prior_node_id and prior_node_id != cached_node_id:
                    logger.warning(
                        "Duplicate node label '%s' seen on %s and %s; "
                        "label-based expressions may be ambiguous",
                        label,
                        prior_node_id,
                        cached_node_id,
                    )
                label_sources[label] = cached_node_id
                upstream_outputs[label] = data_output.value

    for node_id in order:
        execution_ctx = getattr(services, "execution", None)
        stop_run = getattr(execution_ctx, "stop_run", False)
        if isinstance(stop_run, bool) and stop_run:
            break

        node = nodes_by_id.get(node_id)
        if node is None:
            continue

        node_type = node.get("type", "")
        data = node.get("data", {})

        executor = _get_executor(node_type, executors)
        if executor is None or not hasattr(executor, "execute"):
            continue

        if node_id in cached_outputs:
            continue

        on_error = data.get("on_error", "stop")
        started_emitted = False
        try:
            incoming_flow_edges = runtime.incoming_edges(
                node_id, channel=FLOW_EDGE_CHANNEL
            )
            inputs = _gather_inputs(node_id, runtime, port_values)

            # Dead branch detection: has incoming flow edges but none produced data
            if _has_incoming_edges(node_id, incoming_flow_edges) and not inputs:
                continue

            direct_input = inputs.get("input")
            expression_context = getattr(services, "expression_context", None)
            if not isinstance(expression_context, dict):
                expression_context = None

            data = resolve_expressions(
                data,
                direct_input,
                upstream_outputs,
                expression_context=expression_context,
            )
            on_error = data.get("on_error", on_error)

            node_context = FlowContext(
                node_id=node_id,
                chat_id=chat_id,
                run_id=run_id,
                state=state,
                runtime=runtime,
                services=services,
            )

            async for item in _run_executor(
                executor, data, inputs, node_context, run_id
            ):
                if isinstance(item, NodeEvent) and item.event_type == "started":
                    started_emitted = True
                yield item
                if isinstance(item, ExecutionResult):
                    yield NodeEvent(
                        node_id=node_id,
                        node_type=node_type,
                        event_type="result",
                        run_id=run_id,
                        data={
                            "outputs": {
                                handle: {"type": value.type, "value": value.value}
                                for handle, value in item.outputs.items()
                            }
                        },
                    )
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
            if not started_emitted:
                yield NodeEvent(
                    node_id=node_id,
                    node_type=node_type,
                    event_type="started",
                    run_id=run_id,
                )
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

def _ensure_run_id(event: NodeEvent, run_id: str) -> NodeEvent:
    if event.run_id:
        return event
    return NodeEvent(
        node_id=event.node_id,
        node_type=event.node_type,
        event_type=event.event_type,
        run_id=run_id,
        data=event.data,
    )


async def _run_executor(
    executor: Any,
    data: dict[str, Any],
    inputs: dict[str, DataValue],
    context: FlowContext,
    run_id: str,
) -> AsyncIterator[NodeEvent | ExecutionResult]:
    """Call executor.execute(), handling both sync (coroutine) and streaming (async gen)."""
    result = executor.execute(data, inputs, context)
    terminal_event: str | None = None

    if hasattr(result, "__aiter__"):
        started_event: NodeEvent | None = None
        started_emitted = False

        try:
            async for item in result:
                if isinstance(item, NodeEvent):
                    if item.event_type == "started":
                        if started_event is None:
                            started_event = item
                        continue
                    if item.event_type == "completed":
                        continue
                    if item.event_type in {"error", "cancelled"}:
                        terminal_event = item.event_type
                        if not started_emitted:
                            if started_event is not None:
                                yield _ensure_run_id(started_event, run_id)
                            else:
                                yield NodeEvent(
                                    node_id=context.node_id,
                                    node_type=executor.node_type,
                                    event_type="started",
                                    run_id=run_id,
                                )
                            started_emitted = True
                        yield item
                        continue

                if not started_emitted:
                    if started_event is not None:
                        yield _ensure_run_id(started_event, run_id)
                    else:
                        yield NodeEvent(
                            node_id=context.node_id,
                            node_type=executor.node_type,
                            event_type="started",
                            run_id=run_id,
                        )
                    started_emitted = True

                yield item
        except Exception:
            raise
        else:
            if not started_emitted:
                yield NodeEvent(
                    node_id=context.node_id,
                    node_type=executor.node_type,
                    event_type="started",
                    run_id=run_id,
                )

            if terminal_event is None:
                yield NodeEvent(
                    node_id=context.node_id,
                    node_type=executor.node_type,
                    event_type="completed",
                    run_id=run_id,
                )
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
