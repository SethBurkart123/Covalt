"""Node executor protocol and runtime types."""

from __future__ import annotations

import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Protocol


class HookType(StrEnum):
    ON_NODE_CREATE = "onNodeCreate"
    ON_CONNECTION_VALIDATE = "onConnectionValidate"
    ON_ROUTE_EXTRACT = "onRouteExtract"
    ON_ENTRY_RESOLVE = "onEntryResolve"
    ON_RESPONSE_EXTRACT = "onResponseExtract"
    ON_SOCKET_TYPE_PROPAGATE = "onSocketTypePropagate"


class OnNodeCreateHook(Protocol):
    def __call__(self, context: dict[str, Any]) -> dict[str, Any] | None: ...


class OnConnectionValidateHook(Protocol):
    def __call__(self, context: dict[str, Any]) -> bool | None: ...


class OnRouteExtractHook(Protocol):
    def __call__(self, context: dict[str, Any]) -> str | None: ...


class OnEntryResolveHook(Protocol):
    def __call__(self, context: dict[str, Any]) -> str | list[str] | None: ...


class OnResponseExtractHook(Protocol):
    def __call__(self, context: dict[str, Any]) -> dict[str, Any] | None: ...


class OnSocketTypePropagateHook(Protocol):
    def __call__(self, context: dict[str, Any]) -> str | None: ...


PluginHookHandler = (
    OnNodeCreateHook
    | OnConnectionValidateHook
    | OnRouteExtractHook
    | OnEntryResolveHook
    | OnResponseExtractHook
    | OnSocketTypePropagateHook
)


@dataclass(frozen=True)
class RendererDescriptor:
    key: str
    aliases: tuple[str, ...] = ()
    tool_name_patterns: tuple[str, ...] = ()
    has_tool: bool = False
    has_approval: bool = False
    has_message: bool = False
    config_schema: dict[str, str] | None = None


@dataclass(frozen=True)
class PluginManifest:
    id: str
    name: str
    version: str
    nodes: list[str]
    hooks: dict[HookType, list[PluginHookHandler]] = field(default_factory=dict)
    renderers: tuple[RendererDescriptor, ...] = field(default_factory=tuple)


class PluginManifestProtocol(Protocol):
    id: str
    name: str
    version: str
    nodes: list[str]
    hooks: dict[HookType, list[PluginHookHandler]]
    renderers: tuple[RendererDescriptor, ...]


@dataclass
class DataValue:
    type: str  # matches SocketTypeId
    value: Any


@dataclass
class BinaryRef:
    ref: str
    mime_type: str
    size: int
    filename: str | None = None


@dataclass
class NodeEvent:
    node_id: str
    node_type: str
    event_type: str
    run_id: str = ""
    data: dict[str, Any] | None = None
    timestamp: float = field(default_factory=time.time)


@dataclass
class ExecutionResult:
    outputs: dict[str, DataValue]
    events: list[NodeEvent] = field(default_factory=list)


class RuntimeApi(Protocol):
    """Runtime surface exposed to node executors for graph lookups and link resolution."""

    def get_node(self, node_id: str) -> dict[str, Any]: ...

    def get_executor(self, node_type: str) -> Any | None: ...

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


@dataclass
class FlowContext:
    node_id: str
    chat_id: str | None
    run_id: str
    state: Any
    runtime: RuntimeApi | None = None
    services: Any = None


@dataclass
class RuntimeConfigContext:
    mode: str
    graph_data: dict[str, Any]
    node_id: str
    services: Any


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
