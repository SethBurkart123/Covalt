from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from backend.services.flows.graph_runtime import GraphRuntime
from nodes import get_executor
from nodes._types import DataValue, ExecutionResult, FlowContext, NodeEvent
from tests.conftest import collect_events, make_edge, make_graph, make_node


class _StreamingAgentStub:
    def __init__(self, chunks: list[SimpleNamespace]) -> None:
        self._chunks = chunks

    def arun(self, *_args: Any, **_kwargs: Any):
        async def _stream():
            for chunk in self._chunks:
                yield chunk

        return _stream()


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


def test_builtin_plugin_registers_agent_and_llm_completion_executors() -> None:
    agent_executor = get_executor("agent")
    llm_executor = get_executor("llm-completion")

    assert agent_executor is not None
    assert llm_executor is not None
    assert getattr(agent_executor, "node_type", None) == "agent"
    assert getattr(llm_executor, "node_type", None) == "llm-completion"


@pytest.mark.asyncio
async def test_agent_streams_progress_and_returns_final_response_via_registry() -> None:
    executor = get_executor("agent")
    assert executor is not None

    fake_agent = _StreamingAgentStub(
        [
            SimpleNamespace(event="RunContent", run_id="agent-run-1", content="Hello "),
            SimpleNamespace(event="RunContent", run_id="agent-run-1", content="world"),
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
            executor.execute(
                {"model": "openai:gpt-4o"},
                {"input": DataValue(type="data", value={"message": "hi"})},
                _flow_context(node_id="agent-1"),
            )
        )

    progress = [
        event
        for event in events
        if isinstance(event, NodeEvent) and event.event_type == "progress"
    ]
    assert [event.data["token"] for event in progress] == ["Hello ", "world"]

    assert isinstance(result, ExecutionResult)
    assert result.outputs["output"].value["response"] == "Hello world"


@pytest.mark.asyncio
async def test_agent_resolves_linked_tools_from_link_edges_and_emits_metadata() -> None:
    executor = get_executor("agent")
    toolset_executor = get_executor("toolset")

    assert executor is not None
    assert toolset_executor is not None

    fake_tool = MagicMock()
    fake_tool.name = "search_docs"

    tool_registry = MagicMock()
    tool_registry.resolve_tool_ids.return_value = [fake_tool]

    services = SimpleNamespace(tool_registry=tool_registry)
    graph = make_graph(
        nodes=[
            make_node("toolset-1", "toolset", toolset="docs"),
            make_node("agent-1", "agent", model="openai:gpt-4o"),
        ],
        edges=[make_edge("toolset-1", "agent-1", "tools", "tools")],
    )

    runtime = GraphRuntime(
        graph,
        run_id="run-1",
        chat_id="chat-1",
        state=SimpleNamespace(),
        services=services,
        executors={"toolset": toolset_executor},
    )

    tool_call = SimpleNamespace(
        tool_call_id="tool-call-1",
        tool_name="search_docs",
        tool_args={"query": "covalt"},
    )
    fake_agent = _StreamingAgentStub(
        [
            SimpleNamespace(event="ToolCallStarted", run_id="agent-run-2", tool=tool_call),
            SimpleNamespace(event="RunContent", run_id="agent-run-2", content="done"),
            SimpleNamespace(event="RunCompleted", run_id="agent-run-2", content=""),
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
            executor.execute(
                {"model": "openai:gpt-4o"},
                {"input": DataValue(type="data", value={"message": "help"})},
                _flow_context(
                    node_id="agent-1",
                    runtime=runtime,
                    services=services,
                ),
            )
        )

    tool_registry.resolve_tool_ids.assert_called_once_with(["toolset:docs"], chat_id="chat-1")

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
    assert tool_payload["nodeId"] == "toolset-1"
    assert tool_payload["nodeType"] == "toolset"

    assert isinstance(result, ExecutionResult)
    assert result.outputs["output"].value["response"] == "done"


@pytest.mark.asyncio
async def test_llm_completion_streams_tokens_and_returns_full_text_via_registry() -> None:
    executor = get_executor("llm-completion")
    assert executor is not None

    class _Model:
        async def astream(self, _prompt: str, **_kwargs: Any):
            yield "Hi"
            yield " there"

    with patch(
        "nodes.ai.llm_completion.executor.resolve_model",
        return_value=_Model(),
    ):
        events, result = await collect_events(
            executor.execute(
                {
                    "model": "openai:gpt-4o",
                    "temperature": 0.4,
                    "max_tokens": 64,
                },
                {"prompt": DataValue(type="string", value="Say hi")},
                _flow_context(node_id="llm-1"),
            )
        )

    assert isinstance(events[0], NodeEvent)
    assert events[0].event_type == "started"

    progress = [
        event
        for event in events
        if isinstance(event, NodeEvent) and event.event_type == "progress"
    ]
    assert [event.data["token"] for event in progress] == ["Hi", " there"]

    assert isinstance(result, ExecutionResult)
    assert result.outputs["output"].value["text"] == "Hi there"
