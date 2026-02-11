from __future__ import annotations

from collections import defaultdict
from typing import Any

from nodes._types import FlowContext, RuntimeApi

VALID_EDGE_CHANNELS = {"flow", "link"}


def _require_channel(edge: dict[str, Any]) -> str:
    data = edge.get("data")
    if not isinstance(data, dict):
        raise ValueError(f"Edge '{edge.get('id', '<unknown>')}' missing data payload")

    channel = data.get("channel")
    if channel not in VALID_EDGE_CHANNELS:
        raise ValueError(
            f"Edge '{edge.get('id', '<unknown>')}' has invalid channel: {channel!r}"
        )
    return channel


def _incoming_handle(edge: dict[str, Any]) -> str:
    return edge.get("targetHandle") or "input"


def _outgoing_handle(edge: dict[str, Any]) -> str:
    return edge.get("sourceHandle") or "output"


class GraphRuntime(RuntimeApi):
    """Runtime graph API implementation for one execution run."""

    def __init__(
        self,
        graph_data: dict[str, Any],
        *,
        run_id: str,
        chat_id: str | None,
        state: Any,
        tool_registry: Any,
        services: Any,
        executors: dict[str, Any] | None = None,
    ) -> None:
        self._run_id = run_id
        self._chat_id = chat_id
        self._state = state
        self._tool_registry = tool_registry
        self._services = services
        self._executors = executors

        nodes = graph_data.get("nodes", [])
        edges = graph_data.get("edges", [])

        self._nodes_by_id: dict[str, dict[str, Any]] = {
            node["id"]: node
            for node in nodes
            if isinstance(node, dict) and node.get("id")
        }

        self._incoming_by_node: dict[str, list[dict[str, Any]]] = defaultdict(list)
        self._incoming_by_node_channel: dict[tuple[str, str], list[dict[str, Any]]] = (
            defaultdict(list)
        )
        self._outgoing_by_node: dict[str, list[dict[str, Any]]] = defaultdict(list)
        self._outgoing_by_node_channel: dict[tuple[str, str], list[dict[str, Any]]] = (
            defaultdict(list)
        )

        for edge in edges:
            if not isinstance(edge, dict):
                continue

            source = edge.get("source")
            target = edge.get("target")
            if not source or not target:
                continue

            channel = _require_channel(edge)

            self._incoming_by_node[target].append(edge)
            self._incoming_by_node_channel[(target, channel)].append(edge)
            self._outgoing_by_node[source].append(edge)
            self._outgoing_by_node_channel[(source, channel)].append(edge)

        self._cache: dict[str, dict[str, Any]] = defaultdict(dict)
        self._resolution_stack: list[tuple[str, str, str]] = []

    def get_node(self, node_id: str) -> dict[str, Any]:
        node = self._nodes_by_id.get(node_id)
        if node is None:
            raise ValueError(f"Unknown node id: {node_id}")
        return node

    def incoming_edges(
        self,
        node_id: str,
        *,
        channel: str | None = None,
        target_handle: str | None = None,
    ) -> list[dict[str, Any]]:
        if channel is None:
            candidates = self._incoming_by_node.get(node_id, [])
        else:
            candidates = self._incoming_by_node_channel.get((node_id, channel), [])

        if target_handle is None:
            return list(candidates)

        return [edge for edge in candidates if _incoming_handle(edge) == target_handle]

    def outgoing_edges(
        self,
        node_id: str,
        *,
        channel: str | None = None,
        source_handle: str | None = None,
    ) -> list[dict[str, Any]]:
        if channel is None:
            candidates = self._outgoing_by_node.get(node_id, [])
        else:
            candidates = self._outgoing_by_node_channel.get((node_id, channel), [])

        if source_handle is None:
            return list(candidates)

        return [edge for edge in candidates if _outgoing_handle(edge) == source_handle]

    async def resolve_links(self, node_id: str, target_handle: str) -> list[Any]:
        cache_key = f"{node_id}:{target_handle}"
        cached = self.cache_get("resolved_links", cache_key)
        if cached is not None:
            return list(cached)

        self._enter_resolution_scope("resolve", node_id, target_handle)
        try:
            resolved: list[Any] = []
            for edge in self.incoming_edges(
                node_id,
                channel="link",
                target_handle=target_handle,
            ):
                source_id = edge.get("source")
                if not source_id:
                    continue
                output_handle = _outgoing_handle(edge)
                artifact = await self._materialize_node_output(source_id, output_handle)
                if artifact is None:
                    continue
                if isinstance(artifact, list):
                    resolved.extend(artifact)
                else:
                    resolved.append(artifact)

            self.cache_set("resolved_links", cache_key, resolved)
            return list(resolved)
        finally:
            self._exit_resolution_scope()

    async def materialize_output(self, node_id: str, output_handle: str) -> Any:
        return await self._materialize_node_output(node_id, output_handle)

    def cache_get(self, namespace: str, key: str) -> Any | None:
        return self._cache.get(namespace, {}).get(key)

    def cache_set(self, namespace: str, key: str, value: Any) -> None:
        self._cache.setdefault(namespace, {})[key] = value

    def _resolve_executor(self, node_type: str) -> Any | None:
        if self._executors is not None:
            return self._executors.get(node_type)

        from nodes import get_executor

        return get_executor(node_type)

    async def _materialize_node_output(self, node_id: str, output_handle: str) -> Any:
        cache_key = f"{node_id}:{output_handle}"
        cached = self.cache_get("materialized_output", cache_key)
        if cached is not None:
            return cached

        self._enter_resolution_scope("materialize", node_id, output_handle)
        try:
            node = self.get_node(node_id)
            node_type = node.get("type", "")
            executor = self._resolve_executor(node_type)
            if executor is None or not hasattr(executor, "materialize"):
                raise ValueError(
                    f"Node '{node_id}' ({node_type}) cannot materialize '{output_handle}'"
                )

            node_context = FlowContext(
                node_id=node_id,
                chat_id=self._chat_id,
                run_id=self._run_id,
                state=self._state,
                tool_registry=self._tool_registry,
                runtime=self,
                services=self._services,
            )
            artifact = await executor.materialize(
                node.get("data", {}),
                output_handle,
                node_context,
            )
            self.cache_set("materialized_output", cache_key, artifact)
            return artifact
        finally:
            self._exit_resolution_scope()

    def _enter_resolution_scope(self, op: str, node_id: str, handle: str) -> None:
        marker = (op, node_id, handle)
        if marker in self._resolution_stack:
            loop_start = self._resolution_stack.index(marker)
            cycle = self._resolution_stack[loop_start:] + [marker]
            cycle_text = " -> ".join(f"{kind}({nid}.{h})" for kind, nid, h in cycle)
            raise ValueError(f"Link dependency cycle detected: {cycle_text}")
        self._resolution_stack.append(marker)

    def _exit_resolution_scope(self) -> None:
        if self._resolution_stack:
            self._resolution_stack.pop()
