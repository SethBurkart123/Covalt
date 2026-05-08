"""TDD specs for flow node executors (execute() method).

These tests define the contract for executors that process data at runtime.
Phase 3 executors (LLM Completion, Conditional) are live.
Phase 5+ executors are guarded and skipped until implemented.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.runtime import RuntimeMessage, RuntimeToolCall
from backend.runtime.types import (
    ApprovalRequired,
    ContentDelta,
    PendingApproval,
    RunCompleted,
)
from backend.services.streaming import run_control
from nodes._types import (
    DataValue,
    ExecutionResult,
    FlowContext,
    NodeEvent,
)
from nodes._variables import node_model_variable_id
from nodes.ai.llm_completion.executor import LlmCompletionExecutor
from nodes.core.agent.executor import AgentExecutor, LinkedAgentArtifact
from nodes.core.chat_start.executor import ChatStartExecutor
from nodes.core.chat_start.variables_runtime import parse_specs, validate_values
from nodes.flow.conditional.executor import ConditionalExecutor
from nodes.flow.merge.executor import MergeExecutor
from nodes.flow.reroute.executor import RerouteExecutor
from nodes.tools.mcp_server.executor import McpServerExecutor
from nodes.tools.toolset.executor import ToolsetExecutor
from nodes.utility.model_selector.executor import ModelSelectorExecutor
from tests.conftest import collect_events


def _flow_ctx(
    *,
    node_id: str = "test-node",
    chat_id: str | None = "chat-1",
    run_id: str = "run-1",
    state: Any = None,
    tool_registry: Any = None,
    runtime: Any = None,
    services: Any = None,
) -> FlowContext:
    resolved_services = services or SimpleNamespace()
    resolved_registry = tool_registry or getattr(resolved_services, "tool_registry", MagicMock())
    if getattr(resolved_services, "tool_registry", None) is None:
        setattr(resolved_services, "tool_registry", resolved_registry)

    return FlowContext(
        node_id=node_id,
        chat_id=chat_id,
        run_id=run_id,
        state=state or MagicMock(),
        runtime=runtime,
        services=resolved_services,
    )


def _dv(type_: str, value: Any) -> DataValue:
    return DataValue(type=type_, value=value)


class TestChatStartExecutor:
    def test_number_variable_without_step_preserves_decimal(self) -> None:
        specs = parse_specs(
            [
                {
                    "id": "temperature",
                    "label": "Temperature",
                    "control": {"kind": "number"},
                }
            ]
        )

        values = validate_values(specs, {"temperature": 0.7}).values

        assert values["temperature"] == 0.7

    def test_required_variable_rejects_empty_value(self) -> None:
        specs = parse_specs(
            [
                {
                    "id": "topic",
                    "label": "Topic",
                    "control": {"kind": "text"},
                    "required": True,
                }
            ]
        )

        with pytest.raises(ValueError, match=r"Missing required variable value.*Topic"):
            validate_values(specs, {"topic": " "})

    @pytest.mark.asyncio
    async def test_execute_outputs_required_chat_payload_fields(self) -> None:
        executor = ChatStartExecutor()
        chat_input = SimpleNamespace(
            last_user_message="hello from user",
            runtime_messages=[SimpleNamespace(role="user", content="hello from user")],
            last_user_attachments=[{"id": "att-1", "type": "file"}],
        )
        ctx = _flow_ctx(services=SimpleNamespace(chat_input=chat_input))

        result = await executor.execute(
            {"includeUserTools": True},
            {},
            ctx,
        )

        output = result.outputs["output"].value
        assert output["message"] == "hello from user"
        assert output["last_user_message"] == "hello from user"
        assert output["runtime_messages"] == chat_input.runtime_messages
        assert output["attachments"] == chat_input.last_user_attachments
        assert output["include_user_tools"] is True

    @pytest.mark.asyncio
    async def test_contributed_agent_model_variables_are_node_scoped(self) -> None:
        executor = ChatStartExecutor()
        agent_executor = AgentExecutor()
        nodes = {
            "agent-a": {
                "id": "agent-a",
                "type": "agent",
                "data": {"name": "Alpha", "model": "openai:gpt-4o"},
            },
            "agent-b": {
                "id": "agent-b",
                "type": "agent",
                "data": {"name": "Beta", "model": "anthropic:claude-3"},
            },
        }
        outgoing_calls: list[dict[str, Any]] = []

        def outgoing_edges(node_id: str, **kwargs: Any) -> list[dict[str, Any]]:
            outgoing_calls.append({"node_id": node_id, **kwargs})
            if node_id == "chat-start":
                return [
                    {"target": "agent-a"},
                    {"target": "agent-b"},
                ]
            return []

        runtime = SimpleNamespace(
            outgoing_edges=outgoing_edges,
            get_node=lambda node_id: nodes[node_id],
            get_executor=lambda node_type: agent_executor if node_type == "agent" else None,
            incoming_edges=lambda *_args, **_kwargs: [],
        )
        ctx = _flow_ctx(node_id="chat-start", runtime=runtime)

        result = await executor.execute({}, {}, ctx)

        specs = result.outputs["output"].value["variable_specs"]
        by_id = {spec["id"]: spec for spec in specs}
        assert set(by_id) == {
            node_model_variable_id("agent-a"),
            node_model_variable_id("agent-b"),
        }
        spec_a = by_id[node_model_variable_id("agent-a")]
        assert spec_a["contributed_by"] == "Alpha"
        assert spec_a["default"] == "openai:gpt-4o"
        spec_b = by_id[node_model_variable_id("agent-b")]
        assert spec_b["contributed_by"] == "Beta"
        assert spec_b["default"] == "anthropic:claude-3"
        assert any(
            call["node_id"] == "chat-start" and call.get("channel") == "flow"
            for call in outgoing_calls
        )

    @pytest.mark.asyncio
    async def test_non_agent_contributor_keeps_model_id(self) -> None:
        executor = ChatStartExecutor()

        class _Toolset:
            def declare_variables(
                self, _data: dict[str, Any], _ctx: Any
            ) -> list[dict[str, Any]]:
                return [
                    {
                        "id": "model",
                        "label": "Tool model",
                        "control": {"kind": "text"},
                    }
                ]

        nodes = {
            "tool-a": {"id": "tool-a", "type": "toolset", "data": {"name": "Toolbox"}},
        }
        runtime = SimpleNamespace(
            outgoing_edges=lambda node_id, **_: (
                [{"target": "tool-a"}] if node_id == "chat-start" else []
            ),
            get_node=lambda node_id: nodes[node_id],
            get_executor=lambda node_type: _Toolset() if node_type == "toolset" else None,
            incoming_edges=lambda *_args, **_kwargs: [],
        )
        ctx = _flow_ctx(node_id="chat-start", runtime=runtime)

        result = await executor.execute({}, {}, ctx)

        specs = result.outputs["output"].value["variable_specs"]
        assert [spec["id"] for spec in specs] == ["model"]
        assert specs[0]["contributed_by"] == "Toolbox"

    @pytest.mark.asyncio
    async def test_contributor_skipped_when_disable_model_variable_set(self) -> None:
        executor = ChatStartExecutor()
        agent_executor = AgentExecutor()
        nodes = {
            "agent-a": {
                "id": "agent-a",
                "type": "agent",
                "data": {"name": "Alpha", "disableModelVariable": True},
            },
        }
        runtime = SimpleNamespace(
            outgoing_edges=lambda node_id, **_: (
                [{"target": "agent-a"}] if node_id == "chat-start" else []
            ),
            get_node=lambda node_id: nodes[node_id],
            get_executor=lambda node_type: agent_executor if node_type == "agent" else None,
            incoming_edges=lambda *_args, **_kwargs: [],
        )
        ctx = _flow_ctx(node_id="chat-start", runtime=runtime)

        result = await executor.execute({}, {}, ctx)

        assert result.outputs["output"].value["variable_specs"] == []

    @pytest.mark.asyncio
    async def test_execute_falls_back_to_state_user_message_when_chat_input_missing(self) -> None:
        executor = ChatStartExecutor()
        state = SimpleNamespace(user_message="state fallback")
        ctx = _flow_ctx(state=state, services=SimpleNamespace())

        result = await executor.execute({}, {}, ctx)

        output = result.outputs["output"].value
        assert output["message"] == "state fallback"
        assert output["last_user_message"] == "state fallback"
        assert output["runtime_messages"] == []
        assert output["attachments"] == []
        assert output["include_user_tools"] is False

    def test_configure_runtime_sets_primary_agent_id_for_existing_agent_in_chat_mode(
        self,
    ) -> None:
        executor = ChatStartExecutor()
        services = SimpleNamespace(chat_output=SimpleNamespace(primary_agent_id=None))
        context = SimpleNamespace(
            mode="chat",
            graph_data={
                "nodes": [
                    {"id": "agent-1", "type": "agent"},
                    {"id": "other", "type": "toolset"},
                ]
            },
            node_id="chat-start-1",
            services=services,
        )

        executor.configure_runtime({"primaryAgentId": "agent-1"}, context)

        assert services.chat_output.primary_agent_id == "agent-1"
        assert services.chat_output.primary_agent_source == "chat-start-1"


async def _fake_astream(*tokens: str):
    for t in tokens:
        yield t


class TestLlmCompletionExecutor:
    @pytest.mark.asyncio
    async def test_returns_concatenated_text(self) -> None:
        executor = LlmCompletionExecutor()
        ctx = _flow_ctx()

        mock_model = MagicMock()
        mock_model.astream = lambda prompt: _fake_astream("Hello", " ", "world")

        with patch("nodes.ai.llm_completion.executor.resolve_model", return_value=mock_model):
            events, result = await collect_events(
                executor.execute(
                    {"model": "openai:gpt-4o"},
                    {"prompt": _dv("string", "Say hi")},
                    ctx,
                )
            )

        assert isinstance(result, ExecutionResult)
        assert result.outputs["output"].value["text"] == "Hello world"

    @pytest.mark.asyncio
    async def test_yields_progress_events_per_token(self) -> None:
        executor = LlmCompletionExecutor()
        ctx = _flow_ctx()

        mock_model = MagicMock()
        mock_model.astream = lambda prompt: _fake_astream("a", "b", "c")

        with patch("nodes.ai.llm_completion.executor.resolve_model", return_value=mock_model):
            events, result = await collect_events(
                executor.execute({"model": "openai:gpt-4o"}, {"prompt": _dv("string", "go")}, ctx)
            )

        progress = [e for e in events if e.event_type == "progress"]
        assert len(progress) == 3
        assert [e.data["token"] for e in progress] == ["a", "b", "c"]

    @pytest.mark.asyncio
    async def test_yields_started_event_first(self) -> None:
        executor = LlmCompletionExecutor()
        ctx = _flow_ctx()

        mock_model = MagicMock()
        mock_model.astream = lambda prompt: _fake_astream("x")

        with patch("nodes.ai.llm_completion.executor.resolve_model", return_value=mock_model):
            events, _ = await collect_events(
                executor.execute({"model": "openai:gpt-4o"}, {"prompt": _dv("string", "")}, ctx)
            )

        assert len(events) >= 1
        assert events[0].event_type == "started"

    @pytest.mark.asyncio
    async def test_api_failure_yields_error_event(self) -> None:
        executor = LlmCompletionExecutor()
        ctx = _flow_ctx()

        async def _exploding_stream(prompt: str):
            raise RuntimeError("API down")
            yield  # noqa: E501 - makes it an async generator

        mock_model = MagicMock()
        mock_model.astream = _exploding_stream

        with patch("nodes.ai.llm_completion.executor.resolve_model", return_value=mock_model):
            events, result = await collect_events(
                executor.execute({"model": "openai:gpt-4o"}, {"prompt": _dv("string", "")}, ctx)
            )

        error_events = [e for e in events if e.event_type == "error"]
        assert len(error_events) >= 1

    @pytest.mark.asyncio
    async def test_temperature_and_max_tokens_passed(self) -> None:
        executor = LlmCompletionExecutor()
        ctx = _flow_ctx()

        mock_model = MagicMock()
        mock_model.astream = lambda prompt, **kw: _fake_astream("ok")
        captured: dict[str, Any] = {}

        original_astream = mock_model.astream

        async def _capturing_astream(prompt: str, **kwargs: Any):
            captured.update(kwargs)
            async for token in original_astream(prompt):
                yield token

        mock_model.astream = _capturing_astream

        with patch("nodes.ai.llm_completion.executor.resolve_model", return_value=mock_model):
            await collect_events(
                executor.execute(
                    {"model": "openai:gpt-4o", "temperature": 0.7, "max_tokens": 100},
                    {"prompt": _dv("string", "hi")},
                    ctx,
                )
            )

        assert captured.get("temperature") == 0.7
        assert captured.get("max_tokens") == 100

    @pytest.mark.asyncio
    async def test_empty_prompt_returns_empty_text(self) -> None:
        executor = LlmCompletionExecutor()
        ctx = _flow_ctx()

        mock_model = MagicMock()
        mock_model.astream = lambda prompt: _fake_astream()

        with patch("nodes.ai.llm_completion.executor.resolve_model", return_value=mock_model):
            events, result = await collect_events(executor.execute({"model": "openai:gpt-4o"}, {}, ctx))

        assert isinstance(result, ExecutionResult)
        assert result.outputs["output"].value["text"] == ""

    @pytest.mark.asyncio
    async def test_model_input_overrides_inline_model(self) -> None:
        executor = LlmCompletionExecutor()
        ctx = _flow_ctx()

        mock_model = MagicMock()
        mock_model.astream = lambda prompt: _fake_astream("ok")

        with patch("nodes.ai.llm_completion.executor.resolve_model", return_value=mock_model) as resolve_model_mock:
            await collect_events(
                executor.execute(
                    {"model": "openai:gpt-4o"},
                    {
                        "prompt": _dv("string", "go"),
                        "model": _dv("model", "google:gemini-2.5-flash"),
                    },
                    ctx,
                )
            )

        resolve_model_mock.assert_called_once_with("google:gemini-2.5-flash")

    @pytest.mark.asyncio
    async def test_prompt_and_kwargs_can_come_from_inputs(self) -> None:
        executor = LlmCompletionExecutor()
        ctx = _flow_ctx()

        mock_model = MagicMock()
        captured: dict[str, Any] = {}

        async def _capturing_astream(prompt: str, **kwargs: Any):
            captured["prompt"] = prompt
            captured.update(kwargs)
            async for token in _fake_astream("ok"):
                yield token

        mock_model.astream = _capturing_astream

        with patch("nodes.ai.llm_completion.executor.resolve_model", return_value=mock_model):
            await collect_events(
                executor.execute(
                    {"model": "openai:gpt-4o"},
                    {
                        "input": _dv("data", {"text": "from-input"}),
                        "temperature": _dv("float", 0.25),
                        "max_tokens": _dv("int", 16),
                    },
                    ctx,
                )
            )

        assert captured["prompt"] == "from-input"
        assert captured["temperature"] == 0.25
        assert captured["max_tokens"] == 16


class _FakeStreamingAgent:
    def __init__(self, chunks: list[Any]) -> None:
        self._chunks = chunks
        self.model: Any = None
        self.instructions: list[str] | None = None

    async def run(self, messages: list[Any], *, add_history_to_context: bool = True):
        for chunk in self._chunks:
            yield chunk


class _RecordingInputAgent:
    def __init__(self, final_content: str = "") -> None:
        self.final_content = final_content
        self.calls: list[dict[str, Any]] = []

    async def run(self, messages: list[Any], *, add_history_to_context: bool = True):
        self.calls.append({"messages": messages, "add_history_to_context": add_history_to_context})
        yield RunCompleted(content=self.final_content)


class _SlowAgent:
    model: Any = None
    instructions: list[str] | None = None

    async def run(self, messages: list[Any], *, add_history_to_context: bool = True):
        await asyncio.sleep(0.05)
        yield RunCompleted(content="late")


class _ApprovalStreamingAgent:
    def __init__(self, paused_tools: list[Any], continued_chunks: list[Any]) -> None:
        self._paused_tools = paused_tools
        self._continued_chunks = continued_chunks
        self.continue_calls: list[Any] = []

    async def run(self, messages: list[Any], *, add_history_to_context: bool = True):
        pending = [
            PendingApproval(
                tool_call_id=getattr(tool, "tool_call_id", ""),
                tool_name=getattr(tool, "tool_name", ""),
                tool_args=getattr(tool, "tool_args", {}),
            )
            for tool in self._paused_tools
        ]
        yield ApprovalRequired(run_id="run-approval", tools=pending)

    async def continue_run(self, approval: Any):
        self.continue_calls.append(approval)
        for chunk in self._continued_chunks:
            yield chunk


class TestAgentExecutor:
    @pytest.mark.asyncio
    async def test_model_and_instructions_inputs_override_runtime_configuration(
        self,
    ) -> None:
        executor = AgentExecutor()
        fake_agent = _FakeStreamingAgent(
            [
                ContentDelta(text="ok"),
                RunCompleted(content=""),
            ]
        )
        ctx = _flow_ctx()

        with (
            patch(
                "nodes.core.agent.executor._resolve_model",
                return_value=MagicMock(),
            ) as resolve_model,
            patch(
                "nodes.core.agent.executor._build_agent_or_team",
                new=MagicMock(return_value=fake_agent),
            ) as build_agent,
        ):
            events, result = await collect_events(
                executor.execute(
                    {"model": "openai:gpt-4o", "instructions": "inline"},
                    {
                        "input": _dv("data", {"message": "hello"}),
                        "model": _dv("model", "google:gemini-2.5-flash"),
                        "temperature": _dv("float", 0.3),
                        "instructions": _dv("string", "be concise"),
                    },
                    ctx,
                )
            )

        assert any(e.event_type == "started" for e in events)
        assert isinstance(result, ExecutionResult)
        assert result.outputs["output"].value["response"] == "ok"

        resolve_model.assert_called_once_with(
            "google:gemini-2.5-flash",
            node_params={"temperature": 0.3},
            model_options={},
        )
        build_agent.assert_called_once()
        build_args = build_agent.call_args
        assert build_args is not None
        assert build_args.kwargs["instructions"] == ["be concise"]

    @pytest.mark.asyncio
    async def test_variable_model_overrides_saved_model_without_model_input(self) -> None:
        executor = AgentExecutor()
        fake_agent = _FakeStreamingAgent(
            [
                ContentDelta(text="ok"),
                RunCompleted(content=""),
            ]
        )
        ctx = _flow_ctx()

        with (
            patch(
                "nodes.core.agent.executor._resolve_model",
                return_value=MagicMock(),
            ) as resolve_model,
            patch(
                "nodes.core.agent.executor._build_agent_or_team",
                new=MagicMock(return_value=fake_agent),
            ),
        ):
            await collect_events(
                executor.execute(
                    {"model": "openai:gpt-4o"},
                    {
                        "input": _dv(
                            "data",
                            {
                                "message": "hello",
                                "variables": {"model": "anthropic:claude-sonnet"},
                            },
                        ),
                    },
                    ctx,
                )
            )

        resolve_model.assert_called_once_with(
            "anthropic:claude-sonnet",
            node_params={},
            model_options={},
        )

    @pytest.mark.asyncio
    async def test_node_scoped_variable_model_overrides_saved_model(self) -> None:
        executor = AgentExecutor()
        fake_agent = _FakeStreamingAgent(
            [
                ContentDelta(text="ok"),
                RunCompleted(content=""),
            ]
        )
        ctx = _flow_ctx(node_id="agent-a")

        with (
            patch(
                "nodes.core.agent.executor._resolve_model",
                return_value=MagicMock(),
            ) as resolve_model,
            patch(
                "nodes.core.agent.executor._build_agent_or_team",
                new=MagicMock(return_value=fake_agent),
            ),
        ):
            await collect_events(
                executor.execute(
                    {"model": "openai:gpt-4o"},
                    {
                        "input": _dv(
                            "data",
                            {
                                "message": "hello",
                                "variables": {
                                    node_model_variable_id("agent-a"): "anthropic:claude-sonnet"
                                },
                            },
                        ),
                    },
                    ctx,
                )
            )

        resolve_model.assert_called_once_with(
            "anthropic:claude-sonnet",
            node_params={},
            model_options={},
        )

    @pytest.mark.asyncio
    async def test_model_input_overrides_variable_model(self) -> None:
        executor = AgentExecutor()
        fake_agent = _FakeStreamingAgent(
            [
                ContentDelta(text="ok"),
                RunCompleted(content=""),
            ]
        )
        ctx = _flow_ctx()

        with (
            patch(
                "nodes.core.agent.executor._resolve_model",
                return_value=MagicMock(),
            ) as resolve_model,
            patch(
                "nodes.core.agent.executor._build_agent_or_team",
                new=MagicMock(return_value=fake_agent),
            ),
        ):
            await collect_events(
                executor.execute(
                    {"model": "openai:gpt-4o"},
                    {
                        "input": _dv(
                            "data",
                            {
                                "message": "hello",
                                "variables": {"model": "anthropic:claude-sonnet"},
                            },
                        ),
                        "model": _dv("model", "google:gemini-2.5-flash"),
                    },
                    ctx,
                )
            )

        resolve_model.assert_called_once_with(
            "google:gemini-2.5-flash",
            node_params={},
            model_options={},
        )

    @pytest.mark.asyncio
    async def test_materialize_uses_chat_variable_model_before_saved_model(self) -> None:
        executor = AgentExecutor()
        services = SimpleNamespace(
            expression_context={"variables": {"model": "anthropic:claude-sonnet"}},
        )
        ctx = _flow_ctx(services=services)

        with patch(
            "nodes.core.agent.executor._resolve_model",
            return_value=MagicMock(),
        ) as resolve_model:
            await executor.materialize(
                {"model": "openai:gpt-4o"},
                "output",
                ctx,
            )

        resolve_model.assert_called_once_with(
            "anthropic:claude-sonnet",
            node_params={},
            model_options={},
        )

    @pytest.mark.asyncio
    async def test_agent_accepts_openai_tool_calls_from_messages(self) -> None:
        executor = AgentExecutor()
        recording_agent = _RecordingInputAgent()
        ctx = _flow_ctx()

        with (
            patch(
                "nodes.core.agent.executor._resolve_model",
                return_value=MagicMock(),
            ),
            patch(
                "nodes.core.agent.executor._build_agent_or_team",
                new=MagicMock(return_value=recording_agent),
            ),
        ):
            _, result = await collect_events(
                executor.execute(
                    {"model": "openai:gpt-4o"},
                    {
                        "input": _dv(
                            "data",
                            {
                                "message": "pipeline message",
                                "runtime_messages": [
                                    RuntimeMessage(
                                        role="assistant",
                                        content="",
                                        tool_calls=[
                                            RuntimeToolCall(
                                                id="call_1",
                                                name="get_weather",
                                                arguments={"city": "LA"},
                                            )
                                        ],
                                    ),
                                    RuntimeMessage(
                                        role="tool",
                                        tool_call_id="call_1",
                                        content='{"temp":72}',
                                    ),
                                ],
                            },
                        )
                    },
                    ctx,
                )
            )

        assert isinstance(result, ExecutionResult)
        assert len(recording_agent.calls) == 1
        run_messages = recording_agent.calls[0]["messages"]
        assert isinstance(run_messages, list)
        assert len(run_messages) == 2
        assert run_messages[0].role == "assistant"
        assert run_messages[1].role == "tool"
        assert getattr(run_messages[0], "tool_calls", None)
        assert getattr(run_messages[1], "tool_call_id", "") == "call_1"

    @pytest.mark.asyncio
    async def test_agent_accepts_messages_key_from_data_channel(self) -> None:
        executor = AgentExecutor()
        recording_agent = _RecordingInputAgent()
        ctx = _flow_ctx()

        with (
            patch(
                "nodes.core.agent.executor._resolve_model",
                return_value=MagicMock(),
            ),
            patch(
                "nodes.core.agent.executor._build_agent_or_team",
                new=MagicMock(return_value=recording_agent),
            ),
        ):
            _, result = await collect_events(
                executor.execute(
                    {"model": "openai:gpt-4o"},
                    {
                        "input": _dv(
                            "data",
                            {
                                "message": "from upstream",
                                "runtime_messages": [
                                    RuntimeMessage(role="user", content="first"),
                                    RuntimeMessage(role="assistant", content="second"),
                                ],
                            },
                        )
                    },
                    ctx,
                )
            )

        assert isinstance(result, ExecutionResult)
        assert len(recording_agent.calls) == 1
        run_messages = recording_agent.calls[0]["messages"]
        assert isinstance(run_messages, list)
        assert [message.role for message in run_messages] == ["user", "assistant"]
        assert [message.content for message in run_messages] == ["first", "second"]

    @pytest.mark.asyncio
    async def test_agent_falls_back_to_upstream_message_when_no_messages_resolve(
        self,
    ) -> None:
        executor = AgentExecutor()
        recording_agent = _RecordingInputAgent()
        ctx = _flow_ctx()

        with (
            patch(
                "nodes.core.agent.executor._resolve_model",
                return_value=MagicMock(),
            ),
            patch(
                "nodes.core.agent.executor._build_agent_or_team",
                new=MagicMock(return_value=recording_agent),
            ),
        ):
            _, result = await collect_events(
                executor.execute(
                    {"model": "openai:gpt-4o"},
                    {"input": _dv("data", {"message": "from upstream"})},
                    ctx,
                )
            )

        assert isinstance(result, ExecutionResult)
        assert len(recording_agent.calls) == 1
        run_messages = recording_agent.calls[0]["messages"]
        assert isinstance(run_messages, list)
        assert len(run_messages) == 1
        assert run_messages[0].role == "user"
        assert run_messages[0].content == "from upstream"

    @pytest.mark.asyncio
    async def test_materialize_resolves_runtime_link_dependencies(self) -> None:
        executor = AgentExecutor()
        child_agent = LinkedAgentArtifact(
            config=SimpleNamespace(),
            node_id="child-node",
            node_type="agent",
            name="Child",
        )
        runtime = MagicMock()
        runtime.resolve_links = AsyncMock(return_value=[MagicMock(), child_agent])
        ctx = _flow_ctx(runtime=runtime)

        with patch("nodes.core.agent.executor.get_model", return_value="openai:gpt-4o-mini"):
            runnable = await executor.materialize(
                {"model": "openai:gpt-4o"},
                "input",
                ctx,
            )

        assert isinstance(runnable, LinkedAgentArtifact)
        runtime.resolve_links.assert_awaited_once_with("test-node", "tools")
        assert child_agent in runnable.linked_agents
        assert len(runnable.tools) == 1

    @pytest.mark.asyncio
    async def test_materialize_flattens_nested_link_artifacts_in_agent_executor(
        self,
    ) -> None:
        executor = AgentExecutor()
        child_agent = LinkedAgentArtifact(
            config=SimpleNamespace(),
            node_id="child-node",
            node_type="agent",
            name="Child",
        )
        runtime = MagicMock()
        runtime.resolve_links = AsyncMock(return_value=[["tool-a"], child_agent])
        runtime.incoming_edges.return_value = []
        ctx = _flow_ctx(runtime=runtime)

        with patch("nodes.core.agent.executor.get_model", return_value="openai:gpt-4o-mini"):
            runnable = await executor.materialize(
                {"model": "openai:gpt-4o"},
                "input",
                ctx,
            )

        assert isinstance(runnable, LinkedAgentArtifact)
        assert runnable.tools == ["tool-a"]
        assert runnable.linked_agents == [child_agent]

    @pytest.mark.asyncio
    async def test_materialize_rejects_unknown_output_handle(self) -> None:
        executor = AgentExecutor()

        with pytest.raises(ValueError, match="unknown output handle"):
            await executor.materialize(
                {"model": "openai:gpt-4o"},
                "unknown",
                _flow_ctx(),
            )

    @pytest.mark.asyncio
    async def test_materialize_uses_wired_model_input(self) -> None:
        executor = AgentExecutor()
        runtime = MagicMock()
        runtime.resolve_links = AsyncMock(return_value=[])

        def _incoming_edges(
            node_id: str,
            *,
            channel: str | None = None,
            target_handle: str | None = None,
        ) -> list[dict[str, str]]:
            if node_id == "test-node" and channel == "flow" and target_handle == "model":
                return [{"source": "model-1", "sourceHandle": "output"}]
            return []

        runtime.incoming_edges.side_effect = _incoming_edges
        runtime.materialize_output = AsyncMock(return_value="openai:gpt-4o-mini")
        ctx = _flow_ctx(runtime=runtime)
        build_runnable = AsyncMock(return_value=MagicMock())

        with patch(
            "nodes.core.agent.executor._build_runtime_runnable",
            new=build_runnable,
        ):
            await executor.materialize(
                {"model": ""},
                "input",
                ctx,
            )

        assert build_runnable.await_count == 1
        await_args = build_runnable.await_args
        assert await_args is not None
        assert await_args.kwargs["model_str"] == "openai:gpt-4o-mini"
        runtime.materialize_output.assert_awaited_once_with("model-1", "output")

    @pytest.mark.asyncio
    async def test_materialize_skips_extra_tool_ids_without_input_policy(self) -> None:
        executor = AgentExecutor()
        runtime = MagicMock()
        runtime.resolve_links = AsyncMock(return_value=[])
        runtime.incoming_edges.return_value = []

        tool_registry = MagicMock()
        ctx = _flow_ctx(
            runtime=runtime,
            tool_registry=tool_registry,
            services=SimpleNamespace(extra_tool_ids=["mcp:github"]),
        )

        with patch("nodes.core.agent.executor.get_model", return_value="openai:gpt-4o-mini"):
            runnable = await executor.materialize(
                {"model": "openai:gpt-4o"},
                "input",
                ctx,
            )

        tool_registry.resolve_tool_ids.assert_not_called()
        assert isinstance(runnable, LinkedAgentArtifact)
        assert not runnable.tools

    @pytest.mark.asyncio
    async def test_execute_includes_extra_tools_when_input_enables(self) -> None:
        executor = AgentExecutor()
        runtime = MagicMock()
        runtime.resolve_links = AsyncMock(return_value=[])

        tool_registry = MagicMock()
        tool_registry.resolve_tool_ids.return_value = [MagicMock()]
        ctx = _flow_ctx(
            runtime=runtime,
            tool_registry=tool_registry,
            services=SimpleNamespace(extra_tool_ids=["mcp:github"]),
        )

        fake_agent = _FakeStreamingAgent(
            [
                ContentDelta(text="ok"),
                RunCompleted(content=""),
            ]
        )

        with (
            patch("nodes.core.agent.executor.get_model", return_value=MagicMock()),
            patch(
                "nodes.core.agent.executor._build_agent_or_team",
                new=MagicMock(return_value=fake_agent),
            ),
        ):
            await collect_events(
                executor.execute(
                    {"model": "openai:gpt-4o"},
                    {
                        "input": _dv(
                            "data",
                            {"message": "hello", "include_user_tools": True},
                        )
                    },
                    ctx,
                )
            )

        tool_registry.resolve_tool_ids.assert_called_once_with(
            ["mcp:github"],
            chat_id=ctx.chat_id,
        )

    @pytest.mark.asyncio
    async def test_timeout_emits_error_event(self, monkeypatch: pytest.MonkeyPatch) -> None:
        executor = AgentExecutor()
        ctx = _flow_ctx()
        monkeypatch.setattr("nodes.core.agent.executor.AGENT_STREAM_IDLE_TIMEOUT_SECONDS", 0.001)

        with (
            patch(
                "nodes.core.agent.executor._resolve_model",
                return_value=MagicMock(),
            ),
            patch(
                "nodes.core.agent.executor._build_agent_or_team",
                new=MagicMock(return_value=_SlowAgent()),
            ),
        ):
            events, result = await collect_events(
                executor.execute(
                    {},
                    {"input": _dv("data", {"message": "hi"})},
                    ctx,
                )
            )

        error_events = [e for e in events if e.event_type == "error"]
        assert len(error_events) == 1
        assert "timed out" in error_events[0].data["error"].lower()
        assert isinstance(result, ExecutionResult)
        assert result.outputs["output"].value["response"] == ""

    @pytest.mark.asyncio
    async def test_run_paused_emits_approval_events_and_resumes(self) -> None:
        executor = AgentExecutor()
        tool = SimpleNamespace(
            tool_call_id="tool-1",
            tool_name="search_docs",
            tool_args={"query": "covalt"},
        )
        fake_agent = _ApprovalStreamingAgent(
            paused_tools=[tool],
            continued_chunks=[
                ContentDelta(text="ok"),
                RunCompleted(content=""),
            ],
        )
        ctx = _flow_ctx()

        async def _auto_approve() -> None:
            while run_control.get_approval_waiter("run-approval") is None:
                await asyncio.sleep(0)
            run_control.set_approval_response(
                "run-approval",
                approved=True,
                tool_decisions={"tool-1": True},
                edited_args={"tool-1": {"query": "updated"}},
            )

        with (
            patch(
                "nodes.core.agent.executor._resolve_model",
                return_value=MagicMock(),
            ),
            patch(
                "nodes.core.agent.executor._build_agent_or_team",
                new=MagicMock(return_value=fake_agent),
            ),
        ):
            events, result = await asyncio.wait_for(
                asyncio.gather(
                    collect_events(
                        executor.execute(
                            {"model": "openai:gpt-4o"},
                            {"input": _dv("data", {"message": "hello"})},
                            ctx,
                        )
                    ),
                    _auto_approve(),
                ),
                timeout=3,
            )

        flow_events, final = events
        agent_events = [
            e.data.get("event")
            for e in flow_events
            if isinstance(e, NodeEvent) and e.event_type == "agent_event" and isinstance(e.data, dict)
        ]

        assert "ToolApprovalRequired" in agent_events
        assert "ToolApprovalResolved" in agent_events
        assert isinstance(final, ExecutionResult)
        assert final.outputs["output"].value["response"] == "ok"

        assert len(fake_agent.continue_calls) == 1
        continue_call = fake_agent.continue_calls[0]
        assert continue_call.run_id == "run-approval"
        assert len(continue_call.decisions) == 1
        assert continue_call.decisions["tool-1"].approved is True
        assert continue_call.decisions["tool-1"].edited_args == {"query": "updated"}

    @pytest.mark.asyncio
    async def test_run_paused_cancelled_during_approval_does_not_continue_and_denies_tool(
        self,
    ) -> None:
        executor = AgentExecutor()
        tool = SimpleNamespace(
            tool_call_id="tool-1",
            tool_name="search_docs",
            tool_args={"query": "covalt"},
        )
        fake_agent = _ApprovalStreamingAgent(
            paused_tools=[tool],
            continued_chunks=[
                ContentDelta(text="should-not-run"),
                RunCompleted(content=""),
            ],
        )
        ctx = _flow_ctx()

        async def _auto_cancel() -> None:
            while run_control.get_approval_waiter("run-approval") is None:
                await asyncio.sleep(0)
            run_control.cancel_approval_waiter("run-approval")

        with (
            patch(
                "nodes.core.agent.executor._resolve_model",
                return_value=MagicMock(),
            ),
            patch(
                "nodes.core.agent.executor._build_agent_or_team",
                new=MagicMock(return_value=fake_agent),
            ),
        ):
            events, result = await asyncio.wait_for(
                asyncio.gather(
                    collect_events(
                        executor.execute(
                            {"model": "openai:gpt-4o"},
                            {"input": _dv("data", {"message": "hello"})},
                            ctx,
                        )
                    ),
                    _auto_cancel(),
                ),
                timeout=3,
            )

        flow_events, final = events
        assert final is None

        cancelled_events = [
            e
            for e in flow_events
            if isinstance(e, NodeEvent) and e.event_type == "cancelled"
        ]
        assert len(cancelled_events) == 1

        resolved_events = [
            e
            for e in flow_events
            if isinstance(e, NodeEvent)
            and e.event_type == "agent_event"
            and isinstance(e.data, dict)
            and e.data.get("event") == "ToolApprovalResolved"
        ]
        assert len(resolved_events) == 1
        resolved_tool = resolved_events[0].data.get("tool") if isinstance(resolved_events[0].data, dict) else None
        assert isinstance(resolved_tool, dict)
        assert resolved_tool.get("approvalStatus") == "denied"

        assert len(fake_agent.continue_calls) == 0


class TestToolMaterializers:
    @pytest.mark.asyncio
    async def test_toolset_materialize_resolves_toolset_prefix(self) -> None:
        registry = MagicMock()
        registry.resolve_tool_ids.return_value = ["tool-a", "tool-b"]
        ctx = _flow_ctx(tool_registry=registry)

        result = await ToolsetExecutor().materialize(
            {"toolset": "web"},
            "tools",
            ctx,
        )

        assert result == ["tool-a", "tool-b"]
        registry.resolve_tool_ids.assert_called_once_with(
            ["toolset:web"],
            chat_id=ctx.chat_id,
        )

    @pytest.mark.asyncio
    async def test_toolset_materialize_returns_empty_when_not_configured(self) -> None:
        ctx = _flow_ctx(tool_registry=MagicMock())

        result = await ToolsetExecutor().materialize(
            {},
            "tools",
            ctx,
        )

        assert result == []

    @pytest.mark.asyncio
    async def test_toolset_materialize_rejects_unknown_handle(self) -> None:
        with pytest.raises(ValueError, match="unknown output handle"):
            await ToolsetExecutor().materialize(
                {"toolset": "web"},
                "output",
                _flow_ctx(),
            )

    @pytest.mark.asyncio
    async def test_mcp_materialize_resolves_mcp_prefix(self) -> None:
        registry = MagicMock()
        registry.resolve_tool_ids.return_value = ["mcp-tool"]
        ctx = _flow_ctx(tool_registry=registry)

        result = await McpServerExecutor().materialize(
            {"server": "github"},
            "tools",
            ctx,
        )

        assert result == ["mcp-tool"]
        registry.resolve_tool_ids.assert_called_once_with(
            ["mcp:github"],
            chat_id=ctx.chat_id,
        )

    @pytest.mark.asyncio
    async def test_mcp_materialize_returns_empty_when_not_configured(self) -> None:
        ctx = _flow_ctx(tool_registry=MagicMock())

        result = await McpServerExecutor().materialize(
            {},
            "tools",
            ctx,
        )

        assert result == []

    @pytest.mark.asyncio
    async def test_mcp_materialize_rejects_unknown_handle(self) -> None:
        with pytest.raises(ValueError, match="unknown output handle"):
            await McpServerExecutor().materialize(
                {"server": "github"},
                "output",
                _flow_ctx(),
            )

    @pytest.mark.asyncio
    async def test_model_selector_materialize_returns_selected_model(self) -> None:
        runtime = MagicMock()
        runtime.incoming_edges.return_value = []
        ctx = _flow_ctx(runtime=runtime)

        result = await ModelSelectorExecutor().materialize(
            {"model": "openai:gpt-4o"},
            "output",
            ctx,
        )

        assert result == "openai:gpt-4o"

    @pytest.mark.asyncio
    async def test_model_selector_materialize_supports_model_source_handle(
        self,
    ) -> None:
        runtime = MagicMock()
        runtime.incoming_edges.return_value = [{"source": "model-0", "sourceHandle": "model"}]
        runtime.materialize_output = AsyncMock(return_value="google:gemini-2.5-flash")
        ctx = _flow_ctx(runtime=runtime)

        result = await ModelSelectorExecutor().materialize(
            {"model": "openai:gpt-4o"},
            "output",
            ctx,
        )

        assert result == "google:gemini-2.5-flash"

    @pytest.mark.asyncio
    async def test_model_selector_materialize_rejects_unknown_handle(self) -> None:
        with pytest.raises(ValueError, match="unknown output handle"):
            await ModelSelectorExecutor().materialize(
                {"model": "openai:gpt-4o"},
                "tools",
                _flow_ctx(),
            )


class TestConditionalExecutor:
    @pytest.mark.asyncio
    async def test_true_condition_routes_to_true_port(self) -> None:
        executor = ConditionalExecutor()
        result = await executor.execute(
            {"field": "status", "operator": "equals", "value": "active"},
            {"input": _dv("data", {"status": "active"})},
            _flow_ctx(),
        )

        assert isinstance(result, ExecutionResult)
        assert "true" in result.outputs
        assert "false" not in result.outputs

    @pytest.mark.asyncio
    async def test_false_condition_routes_to_false_port(self) -> None:
        executor = ConditionalExecutor()
        result = await executor.execute(
            {"field": "status", "operator": "equals", "value": "active"},
            {"input": _dv("data", {"status": "inactive"})},
            _flow_ctx(),
        )

        assert "false" in result.outputs
        assert "true" not in result.outputs

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "operator, field_val, compare_val, expected_port",
        [
            ("equals", "hello", "hello", "true"),
            ("equals", "hello", "world", "false"),
            ("contains", "hello world", "world", "true"),
            ("contains", "hello world", "xyz", "false"),
            ("greaterThan", 10, 5, "true"),
            ("greaterThan", 3, 5, "false"),
            ("lessThan", 3, 5, "true"),
            ("lessThan", 10, 5, "false"),
            ("startsWith", "hello world", "hello", "true"),
            ("startsWith", "hello world", "world", "false"),
        ],
        ids=[
            "equals-match",
            "equals-no-match",
            "contains-match",
            "contains-no-match",
            "gt-match",
            "gt-no-match",
            "lt-match",
            "lt-no-match",
            "startsWith-match",
            "startsWith-no-match",
        ],
    )
    async def test_operators(
        self,
        operator: str,
        field_val: Any,
        compare_val: Any,
        expected_port: str,
    ) -> None:
        executor = ConditionalExecutor()
        result = await executor.execute(
            {"field": "val", "operator": operator, "value": compare_val},
            {"input": _dv("data", {"val": field_val})},
            _flow_ctx(),
        )

        assert expected_port in result.outputs
        other = "false" if expected_port == "true" else "true"
        assert other not in result.outputs

    @pytest.mark.asyncio
    async def test_case_insensitive_string_comparison(self) -> None:
        executor = ConditionalExecutor()
        result = await executor.execute(
            {
                "field": "name",
                "operator": "equals",
                "value": "alice",
                "caseSensitive": False,
            },
            {"input": _dv("data", {"name": "ALICE"})},
            _flow_ctx(),
        )

        assert "true" in result.outputs

    @pytest.mark.asyncio
    async def test_missing_field_routes_to_false(self) -> None:
        executor = ConditionalExecutor()
        result = await executor.execute(
            {"field": "missing_key", "operator": "equals", "value": "anything"},
            {"input": _dv("data", {"other_key": "value"})},
            _flow_ctx(),
        )

        assert "false" in result.outputs
        assert "true" not in result.outputs

    @pytest.mark.asyncio
    async def test_not_equals_operator_routes_to_true_when_values_differ(self) -> None:
        executor = ConditionalExecutor()
        result = await executor.execute(
            {"field": "status", "operator": "notEquals", "value": "active"},
            {"input": _dv("data", {"status": "inactive"})},
            _flow_ctx(),
        )

        assert "true" in result.outputs
        assert "false" not in result.outputs

    @pytest.mark.asyncio
    async def test_not_contains_operator_routes_to_true_when_substring_absent(self) -> None:
        executor = ConditionalExecutor()
        result = await executor.execute(
            {"field": "message", "operator": "notContains", "value": "error"},
            {"input": _dv("data", {"message": "all good"})},
            _flow_ctx(),
        )

        assert "true" in result.outputs
        assert "false" not in result.outputs

    @pytest.mark.asyncio
    async def test_exists_with_missing_field_routes_to_false(self) -> None:
        executor = ConditionalExecutor()
        result = await executor.execute(
            {"field": "missing", "operator": "exists"},
            {"input": _dv("data", {"present": 1})},
            _flow_ctx(),
        )

        assert "false" in result.outputs
        assert "true" not in result.outputs

    @pytest.mark.asyncio
    async def test_not_exists_with_missing_field_routes_to_true(self) -> None:
        executor = ConditionalExecutor()
        result = await executor.execute(
            {"field": "missing", "operator": "notExists"},
            {"input": _dv("data", {"present": 1})},
            _flow_ctx(),
        )

        assert "true" in result.outputs
        assert "false" not in result.outputs


class TestMergeExecutor:
    @pytest.mark.asyncio
    async def test_merge_outputs_values_in_handle_index_order(self) -> None:
        executor = MergeExecutor()

        result = await executor.execute(
            {},
            {
                "input_3": _dv("data", "third"),
                "input": _dv("data", "first"),
                "input_2": _dv("data", "second"),
            },
            _flow_ctx(),
        )

        assert isinstance(result, ExecutionResult)
        assert result.outputs["output"].value == ["first", "second", "third"]

    @pytest.mark.asyncio
    async def test_merge_ignores_non_input_handles(self) -> None:
        executor = MergeExecutor()

        result = await executor.execute(
            {},
            {
                "input": _dv("data", "kept"),
                "foo": _dv("data", "ignored"),
                "input_0": _dv("data", "ignored"),
                "input_bad": _dv("data", "ignored"),
            },
            _flow_ctx(),
        )

        assert result.outputs["output"].value == ["kept"]


class TestRerouteExecutor:
    @pytest.mark.asyncio
    async def test_execute_passes_through_connected_input_value(self) -> None:
        executor = RerouteExecutor()

        result = await executor.execute(
            {"value": "fallback"},
            {"input": _dv("json", {"ok": True})},
            _flow_ctx(),
        )

        assert result.outputs["output"].type == "json"
        assert result.outputs["output"].value == {"ok": True}

    @pytest.mark.asyncio
    async def test_execute_uses_default_value_with_propagated_socket_type_when_unconnected(
        self,
    ) -> None:
        executor = RerouteExecutor()

        result = await executor.execute(
            {"_socketType": "model", "value": "openai:gpt-4o"},
            {},
            _flow_ctx(),
        )

        assert result.outputs["output"].type == "model"
        assert result.outputs["output"].value == "openai:gpt-4o"

    @pytest.mark.asyncio
    async def test_materialize_prefers_flow_channel_then_flattens_link_artifacts(self) -> None:
        executor = RerouteExecutor()

        runtime = MagicMock()
        runtime.incoming_edges.side_effect = [
            [{"source": "upstream", "sourceHandle": "output"}],
            [{"source": "tool-a", "sourceHandle": "tools"}],
        ]
        runtime.materialize_output = AsyncMock(side_effect=[{"payload": 1}, ["tool-1"]])

        result = await executor.materialize(
            {"value": "fallback"},
            "output",
            _flow_ctx(runtime=runtime),
        )

        assert result == {"payload": 1}

        flow_calls = [call for call in runtime.incoming_edges.call_args_list if call.kwargs.get("channel") == "flow"]
        assert len(flow_calls) == 1

        runtime.incoming_edges.reset_mock()
        runtime.incoming_edges.side_effect = [[], [{"source": "tool-a", "sourceHandle": "tools"}]]
        runtime.materialize_output = AsyncMock(return_value=["tool-1"])

        _ = await executor.materialize(
            {"value": "fallback"},
            "output",
            _flow_ctx(runtime=runtime),
        )

        link_calls = [call for call in runtime.incoming_edges.call_args_list if call.kwargs.get("channel") == "link"]
        assert len(link_calls) == 1

    @pytest.mark.asyncio
    async def test_materialize_aggregates_link_channel_and_falls_back_to_default(self) -> None:
        executor = RerouteExecutor()

        runtime = MagicMock()
        runtime.incoming_edges.side_effect = [
            [],
            [
                {"source": "tool-a", "sourceHandle": "output"},
                {"source": "tool-b", "sourceHandle": "output"},
            ],
        ]
        runtime.materialize_output = AsyncMock(side_effect=[["a", "b"], "c"])

        artifacts = await executor.materialize(
            {"value": "fallback"},
            "output",
            _flow_ctx(runtime=runtime),
        )

        assert artifacts == ["a", "b", "c"]

        runtime.incoming_edges.side_effect = [[], []]
        runtime.materialize_output = AsyncMock(return_value=None)

        fallback = await executor.materialize(
            {"value": "fallback"},
            "output",
            _flow_ctx(runtime=runtime),
        )

        assert fallback == "fallback"

    @pytest.mark.asyncio
    async def test_materialize_rejects_unknown_output_handle(self) -> None:
        with pytest.raises(ValueError, match="unknown output handle"):
            await RerouteExecutor().materialize({}, "tools", _flow_ctx())
