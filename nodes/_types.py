"""Node executor protocol and runtime types."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Protocol
import time


# ── Runtime data ────────────────────────────────────────────────────


@dataclass
class DataValue:
    """What flows through edges at runtime."""

    type: str  # matches SocketTypeId
    value: Any


@dataclass
class BinaryRef:
    """Pointer to large content stored on disk."""

    ref: str
    mime_type: str
    size: int
    filename: str | None = None


# ── Events ──────────────────────────────────────────────────────────


@dataclass
class NodeEvent:
    """Emitted by nodes during execution. Powers the chat UI + canvas."""

    node_id: str
    node_type: str
    event_type: str  # started | progress | completed | error | agent_event
    run_id: str = ""
    data: dict[str, Any] | None = None
    timestamp: float = field(default_factory=time.time)


# ── Execution result ────────────────────────────────────────────────


@dataclass
class ExecutionResult:
    """What execute() returns. Outputs dict = which output ports have values."""

    outputs: dict[str, DataValue]
    events: list[NodeEvent] = field(default_factory=list)


class RuntimeApi(Protocol):
    """Generic runtime surface exposed to node executors.

    The runtime kernel owns graph orchestration; nodes use this protocol for
    graph lookups and link/materialization dependency resolution.
    """

    def get_node(self, node_id: str) -> dict[str, Any]: ...

    def incoming_edges(
        self,
        node_id: str,
        *,
        channel: str | None = None,
        target_handle: str | None = None,
    ) -> list[dict[str, Any]]: ...

    def outgoing_edges(
        self,
        node_id: str,
        *,
        channel: str | None = None,
        source_handle: str | None = None,
    ) -> list[dict[str, Any]]: ...

    async def resolve_links(self, node_id: str, target_handle: str) -> list[Any]: ...

    async def materialize_output(self, node_id: str, output_handle: str) -> Any: ...

    def cache_get(self, namespace: str, key: str) -> Any | None: ...

    def cache_set(self, namespace: str, key: str, value: Any) -> None: ...


# ── Contexts ────────────────────────────────────────────────────────


@dataclass
class FlowContext:
    """Provided to flow executors during Phase 2."""

    node_id: str
    chat_id: str | None
    run_id: str
    state: Any  # FlowState
    runtime: RuntimeApi | None = None
    services: Any = None


@dataclass
class RuntimeConfigContext:
    """Context for runtime configuration hooks."""

    mode: str
    graph_data: dict[str, Any]
    node_id: str
    services: Any


# ── Executor protocol ───────────────────────────────────────────────


class FlowExecutor(Protocol):
    node_type: str

    async def execute(
        self,
        data: dict[str, Any],
        inputs: dict[str, DataValue],
        context: FlowContext,
    ) -> ExecutionResult | AsyncIterator[NodeEvent | ExecutionResult]: ...


class LinkMaterializer(Protocol):
    node_type: str

    async def materialize(
        self,
        data: dict[str, Any],
        output_handle: str,
        context: FlowContext,
    ) -> Any: ...


class RuntimeConfigurator(Protocol):
    node_type: str

    def configure_runtime(
        self, data: dict[str, Any], context: RuntimeConfigContext
    ) -> None: ...
