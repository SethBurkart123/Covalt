from __future__ import annotations

import re
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.services.graph_runtime import GraphRuntime
from nodes import get_executor
from nodes._types import DataValue, ExecutionResult, FlowContext, NodeEvent
from nodes.data.code import executor as code_executor_module
from tests.conftest import collect_events, make_edge, make_graph, make_node

TARGET_NODE_MANIFEST_PATHS: dict[str, tuple[str, str]] = {
    "mcp-server": (
        "nodes/tools/mcp_server/definition.ts",
        "nodes/tools/mcp_server/executor.py",
    ),
    "toolset": (
        "nodes/tools/toolset/definition.ts",
        "nodes/tools/toolset/executor.py",
    ),
    "code": (
        "nodes/data/code/definition.ts",
        "nodes/data/code/executor.py",
    ),
    "model-selector": (
        "nodes/utility/model_selector/definition.ts",
        "nodes/utility/model_selector/executor.py",
    ),
}


class _StreamingAgentStub:
    def __init__(self, chunks: list[SimpleNamespace]) -> None:
        self._chunks = chunks

    def arun(self, *_args: Any, **_kwargs: Any):
        async def _stream():
            for chunk in self._chunks:
                yield chunk

        return _stream()


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _manifest_entries() -> dict[str, tuple[str, str]]:
    manifest_path = _repo_root() / "nodes" / "manifest.ts"
    source = manifest_path.read_text(encoding="utf-8")
    pattern = re.compile(
        r"\{\s*type:\s*'([^']+)'\s*,\s*definitionPath:\s*'([^']+)'\s*,\s*executorPath:\s*'([^']+)'",
        re.MULTILINE,
    )
    return {
        node_type: (definition_path, executor_path)
        for node_type, definition_path, executor_path in pattern.findall(source)
    }


def _flow_context(
    *,
    node_id: str,
    run_id: str = "run-1",
    chat_id: str | None = "chat-1",
    runtime: GraphRuntime | None = None,
    services: Any | None = None,
) -> FlowContext:
    return FlowContext(
        node_id=node_id,
        run_id=run_id,
        chat_id=chat_id,
        state=SimpleNamespace(),
        runtime=runtime,
        services=services or SimpleNamespace(),
    )


def test_builtin_plugin_manifest_registers_definition_and_executor_paths_for_target_nodes() -> None:
    manifest_entries = _manifest_entries()

    for node_type, expected_paths in TARGET_NODE_MANIFEST_PATHS.items():
        assert manifest_entries.get(node_type) == expected_paths

        definition_path, executor_path = expected_paths
        assert (_repo_root() / definition_path).exists()
        assert (_repo_root() / executor_path).exists()


def test_builtin_plugin_registers_target_node_executors_via_registry() -> None:
    for node_type in TARGET_NODE_MANIFEST_PATHS:
        executor = get_executor(node_type)
        assert executor is not None
        assert getattr(executor, "node_type", None) == node_type


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "node_type,config_field,config_value,id_prefix",
    [
        ("mcp-server", "server", "github", "mcp"),
        ("toolset", "toolset", "docs", "toolset"),
    ],
)
async def test_tools_nodes_materialize_tools_via_registry_resolution(
    node_type: str,
    config_field: str,
    config_value: str,
    id_prefix: str,
) -> None:
    executor = get_executor(node_type)
    assert executor is not None

    fake_tool = SimpleNamespace(name="search_docs")
    tool_registry = MagicMock()
    tool_registry.resolve_tool_ids.return_value = [fake_tool]

    context = _flow_context(
        node_id=f"{node_type}-1",
        services=SimpleNamespace(tool_registry=tool_registry),
    )

    result = await executor.materialize(
        {config_field: config_value},
        "tools",
        context,
    )

    assert result == [fake_tool]
    tool_registry.resolve_tool_ids.assert_called_once_with(
        [f"{id_prefix}:{config_value}"],
        chat_id="chat-1",
    )
    assert getattr(fake_tool, "__agno_node_id", None) == f"{node_type}-1"
    assert getattr(fake_tool, "__agno_node_type", None) == node_type


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "node_type,node_data,id_lookup",
    [
        ("mcp-server", {"server": "github"}, "mcp:github"),
        ("toolset", {"toolset": "docs"}, "toolset:docs"),
    ],
)
async def test_tools_nodes_materialized_tools_are_available_to_downstream_agent_nodes(
    node_type: str,
    node_data: dict[str, str],
    id_lookup: str,
) -> None:
    agent_executor = get_executor("agent")
    source_executor = get_executor(node_type)

    assert agent_executor is not None
    assert source_executor is not None

    fake_tool = MagicMock()
    fake_tool.name = "search_docs"

    tool_registry = MagicMock()
    tool_registry.resolve_tool_ids.return_value = [fake_tool]

    services = SimpleNamespace(tool_registry=tool_registry)
    graph = make_graph(
        nodes=[
            make_node("tools-1", node_type, **node_data),
            make_node("agent-1", "agent", model="openai:gpt-4o"),
        ],
        edges=[make_edge("tools-1", "agent-1", "tools", "tools")],
    )

    runtime = GraphRuntime(
        graph,
        run_id="run-1",
        chat_id="chat-1",
        state=SimpleNamespace(),
        services=services,
        executors={node_type: source_executor},
    )

    tool_call = SimpleNamespace(
        tool_call_id="tool-call-1",
        tool_name="search_docs",
        tool_args={"query": "covalt"},
    )
    fake_agent = _StreamingAgentStub(
        [
            SimpleNamespace(event="ToolCallStarted", run_id="agent-run-1", tool=tool_call),
            SimpleNamespace(event="RunContent", run_id="agent-run-1", content="done"),
            SimpleNamespace(event="RunCompleted", run_id="agent-run-1", content=""),
        ]
    )

    with patch(
        "nodes.core.agent.executor._resolve_model",
        return_value=MagicMock(),
    ), patch(
        "nodes.core.agent.executor._build_agent_or_team",
        new=MagicMock(return_value=fake_agent),
    ):
        events, result = await collect_events(
            agent_executor.execute(
                {"model": "openai:gpt-4o"},
                {"input": DataValue(type="data", value={"message": "help"})},
                _flow_context(
                    node_id="agent-1",
                    runtime=runtime,
                    services=services,
                ),
            )
        )

    tool_registry.resolve_tool_ids.assert_called_once_with([id_lookup], chat_id="chat-1")

    tool_started_events = [
        event
        for event in events
        if isinstance(event, NodeEvent)
        and event.event_type == "agent_event"
        and isinstance(event.data, dict)
        and event.data.get("event") == "ToolCallStarted"
    ]
    assert len(tool_started_events) == 1

    tool_payload = tool_started_events[0].data["tool"]
    assert tool_payload["toolName"] == "search_docs"
    assert tool_payload["nodeId"] == "tools-1"
    assert tool_payload["nodeType"] == node_type

    assert isinstance(result, ExecutionResult)
    assert result.outputs["output"].value["response"] == "done"


@pytest.mark.asyncio
async def test_code_node_blank_code_returns_input_unchanged() -> None:
    executor = get_executor("code")
    assert executor is not None

    input_value = {"nested": {"value": 1}, "items": [1, 2, 3]}
    result = await executor.execute(
        {"code": "   \n  "},
        {"input": DataValue(type="data", value=input_value)},
        _flow_context(node_id="code-1"),
    )

    assert result.outputs["output"].type == "data"
    assert result.outputs["output"].value == input_value


@pytest.mark.asyncio
@pytest.mark.skipif(code_executor_module.quickjs is None, reason="quickjs is not installed")
async def test_code_node_executes_javascript_with_input_trigger_and_node_helpers() -> None:
    executor = get_executor("code")
    assert executor is not None

    context = _flow_context(
        node_id="code-1",
        services=SimpleNamespace(
            expression_context={"trigger": {"source": "webhook"}},
            upstream_outputs={"source": {"answer": 42}},
        ),
    )

    result = await executor.execute(
        {
            "code": (
                "return {"
                " inputValue: $input.value,"
                " triggerSource: $trigger.source,"
                " upstreamAnswer: $('source').item.json.answer"
                " };"
            )
        },
        {"input": DataValue(type="data", value={"value": "hello"})},
        context,
    )

    assert result.outputs["output"].type == "data"
    assert result.outputs["output"].value == {
        "inputValue": "hello",
        "triggerSource": "webhook",
        "upstreamAnswer": 42,
    }


@pytest.mark.asyncio
@pytest.mark.skipif(code_executor_module.quickjs is None, reason="quickjs is not installed")
async def test_code_node_returns_json_safe_output() -> None:
    executor = get_executor("code")
    assert executor is not None

    result = await executor.execute(
        {
            "code": (
                "const value = {"
                " createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),"
                " labels: ['a', 'b'],"
                " nested: { ok: true }"
                " };"
                " return value;"
            )
        },
        {"input": DataValue(type="data", value={})},
        _flow_context(node_id="code-2"),
    )

    assert result.outputs["output"].value == {
        "createdAt": "2026-01-01T00:00:00.000Z",
        "labels": ["a", "b"],
        "nested": {"ok": True},
    }


@pytest.mark.asyncio
async def test_model_selector_connected_input_takes_precedence_over_local_config() -> None:
    executor = get_executor("model-selector")
    assert executor is not None

    result = await executor.execute(
        {"model": "openai:gpt-4o"},
        {"model": DataValue(type="model", value="google:gemini-2.5-flash")},
        _flow_context(node_id="model-1"),
    )

    assert result.outputs["output"].type == "model"
    assert result.outputs["output"].value == "google:gemini-2.5-flash"


@pytest.mark.asyncio
@pytest.mark.parametrize("output_handle", ["output", "model"])
async def test_model_selector_materialize_supports_output_and_model_handles(
    output_handle: str,
) -> None:
    executor = get_executor("model-selector")
    assert executor is not None

    runtime = MagicMock()
    runtime.incoming_edges.return_value = [{"source": "model-source", "sourceHandle": "output"}]
    runtime.materialize_output = AsyncMock(return_value="anthropic:claude-sonnet-4")

    context = _flow_context(node_id="model-2", runtime=runtime)
    materialized = await executor.materialize(
        {"model": "openai:gpt-4o"},
        output_handle,
        context,
    )

    assert materialized == "anthropic:claude-sonnet-4"
    runtime.incoming_edges.assert_called_once_with(
        "model-2",
        channel="flow",
        target_handle="model",
    )
    runtime.materialize_output.assert_awaited_once_with("model-source", "output")
