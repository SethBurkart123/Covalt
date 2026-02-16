from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from backend.services.flow_executor import run_flow
from backend.services.graph_runtime import GraphRuntime
from nodes._types import DataValue, ExecutionResult, FlowContext


class _LiteralMaterializer:
    node_type = "literal-provider"

    def __init__(self, value: Any) -> None:
        self.value = value
        self.calls = 0

    async def materialize(
        self,
        data: dict[str, Any],
        output_handle: str,
        context: FlowContext,
    ) -> Any:
        del data, output_handle, context
        self.calls += 1
        return self.value


class _CompositeMaterializer:
    node_type = "composite-provider"

    def __init__(self) -> None:
        self.calls = 0

    async def materialize(
        self,
        data: dict[str, Any],
        output_handle: str,
        context: FlowContext,
    ) -> Any:
        del data, output_handle
        self.calls += 1
        upstream = await context.runtime.resolve_links(context.node_id, "upstream")
        return [*upstream, "composite"]


class _LoopMaterializer:
    node_type = "loop-provider"

    async def materialize(
        self,
        data: dict[str, Any],
        output_handle: str,
        context: FlowContext,
    ) -> Any:
        del data, output_handle
        return await context.runtime.resolve_links(context.node_id, "deps")


class _RuntimeProbeExecutor:
    node_type = "runtime-probe"

    async def execute(
        self,
        data: dict[str, Any],
        inputs: dict[str, DataValue],
        context: FlowContext,
    ) -> ExecutionResult:
        del data, inputs
        links = await context.runtime.resolve_links(context.node_id, "deps")
        return ExecutionResult(
            outputs={"output": DataValue(type="data", value={"links": links})}
        )


class _ChatStartStub:
    node_type = "chat-start"

    async def execute(
        self,
        data: dict[str, Any],
        inputs: dict[str, DataValue],
        context: FlowContext,
    ) -> ExecutionResult:
        del data, inputs, context
        return ExecutionResult(
            outputs={"output": DataValue(type="data", value={"message": "hello"})}
        )


def _runtime(
    graph_data: dict[str, Any], executors: dict[str, Any] | None = None
) -> GraphRuntime:
    return GraphRuntime(
        graph_data,
        run_id="run-1",
        chat_id="chat-1",
        state=SimpleNamespace(user_message="hello"),
        services=SimpleNamespace(tool_registry=SimpleNamespace()),
        executors=executors,
    )


@pytest.mark.asyncio
async def test_runtime_resolves_custom_link_handles_without_domain_coupling() -> None:
    producer = _LiteralMaterializer({"kind": "artifact"})
    runtime = _runtime(
        {
            "nodes": [
                {"id": "source", "type": "literal-provider", "data": {}},
                {"id": "target", "type": "consumer", "data": {}},
            ],
            "edges": [
                {
                    "id": "edge-1",
                    "source": "source",
                    "sourceHandle": "outlet",
                    "target": "target",
                    "targetHandle": "inlet",
                    "data": {"channel": "link"},
                }
            ],
        },
        executors={"literal-provider": producer},
    )

    links = await runtime.resolve_links("target", "inlet")

    assert links == [{"kind": "artifact"}]
    assert producer.calls == 1


@pytest.mark.asyncio
async def test_runtime_resolve_links_supports_nested_dependencies_and_cache_hits() -> (
    None
):
    literal = _LiteralMaterializer("leaf")
    composite = _CompositeMaterializer()
    runtime = _runtime(
        {
            "nodes": [
                {"id": "leaf", "type": "literal-provider", "data": {}},
                {"id": "mid", "type": "composite-provider", "data": {}},
                {"id": "root", "type": "consumer", "data": {}},
            ],
            "edges": [
                {
                    "id": "l1",
                    "source": "leaf",
                    "sourceHandle": "emit",
                    "target": "mid",
                    "targetHandle": "upstream",
                    "data": {"channel": "link"},
                },
                {
                    "id": "l2",
                    "source": "mid",
                    "sourceHandle": "emit",
                    "target": "root",
                    "targetHandle": "deps",
                    "data": {"channel": "link"},
                },
            ],
        },
        executors={
            "literal-provider": literal,
            "composite-provider": composite,
        },
    )

    first = await runtime.resolve_links("root", "deps")
    second = await runtime.resolve_links("root", "deps")

    assert first == [["leaf", "composite"]]
    assert second == [["leaf", "composite"]]
    assert literal.calls == 1
    assert composite.calls == 1


@pytest.mark.asyncio
async def test_runtime_resolve_links_reports_link_cycles_with_path() -> None:
    runtime = _runtime(
        {
            "nodes": [
                {"id": "a", "type": "loop-provider", "data": {}},
                {"id": "b", "type": "loop-provider", "data": {}},
            ],
            "edges": [
                {
                    "id": "ab",
                    "source": "a",
                    "sourceHandle": "emit",
                    "target": "b",
                    "targetHandle": "deps",
                    "data": {"channel": "link"},
                },
                {
                    "id": "ba",
                    "source": "b",
                    "sourceHandle": "emit",
                    "target": "a",
                    "targetHandle": "deps",
                    "data": {"channel": "link"},
                },
            ],
        },
        executors={"loop-provider": _LoopMaterializer()},
    )

    with pytest.raises(ValueError, match="Link dependency cycle detected") as exc:
        await runtime.resolve_links("a", "deps")

    message = str(exc.value)
    assert "a" in message
    assert "b" in message


@pytest.mark.asyncio
async def test_run_flow_injects_graph_runtime_into_flow_context() -> None:
    executors = {
        "chat-start": _ChatStartStub(),
        "runtime-probe": _RuntimeProbeExecutor(),
        "literal-provider": _LiteralMaterializer("tool-a"),
    }
    graph = {
        "nodes": [
            {"id": "cs", "type": "chat-start", "data": {}},
            {"id": "probe", "type": "runtime-probe", "data": {}},
            {"id": "provider", "type": "literal-provider", "data": {}},
        ],
        "edges": [
            {
                "id": "f1",
                "source": "cs",
                "sourceHandle": "output",
                "target": "probe",
                "targetHandle": "input",
                "data": {"channel": "flow"},
            },
            {
                "id": "l1",
                "source": "provider",
                "sourceHandle": "emit",
                "target": "probe",
                "targetHandle": "deps",
                "data": {"channel": "link"},
            },
        ],
    }

    context = SimpleNamespace(
        run_id="run-1",
        chat_id="chat-1",
        state=SimpleNamespace(user_message="hello"),
        services=SimpleNamespace(tool_registry=SimpleNamespace()),
    )

    outputs: list[ExecutionResult] = []
    async for item in run_flow(graph, context, executors=executors):
        if isinstance(item, ExecutionResult):
            outputs.append(item)

    assert outputs
    assert outputs[-1].outputs["output"].value == {"links": ["tool-a"]}
