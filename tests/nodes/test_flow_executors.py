"""TDD specs for flow node executors (execute() method).

These tests define the contract for executors that process data at runtime.
Phase 3 executors (LLM Completion, Prompt Template, Conditional) are live.
Phase 5+ executors are guarded and skipped until implemented.
"""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from typing import Any, AsyncIterator, Iterator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from agno.agent import Agent, Message
from agno.db.in_memory import InMemoryDb
from agno.team import Team
from backend.services import run_control

# ── Core types — always available ────────────────────────────────────
from nodes._types import (
    DataValue,
    ExecutionResult,
    FlowContext,
    NodeEvent,
)

# ── Phase 3 executors — available now ────────────────────────────────
from nodes.ai.llm_completion.executor import LlmCompletionExecutor
from nodes.ai.prompt_template.executor import PromptTemplateExecutor
from nodes.core.agent.executor import AgentExecutor
from nodes.flow.conditional.executor import ConditionalExecutor
from nodes.tools.mcp_server.executor import McpServerExecutor
from nodes.tools.toolset.executor import ToolsetExecutor
from nodes.utility.model_selector.executor import ModelSelectorExecutor

# ── Phase 5+ executors — guarded until implemented ──────────────────
try:
    from nodes.data.filter.executor import FilterExecutor
    from nodes.data.text_split.executor import TextSplitExecutor
    from nodes.data.type_converter.executor import TypeConverterExecutor
    from nodes.integration.http_request.executor import HttpRequestExecutor

    _FUTURE_EXECUTORS_AVAILABLE = True
except ImportError:
    _FUTURE_EXECUTORS_AVAILABLE = False

    class FilterExecutor:  # type: ignore[no-redef]
        node_type = "filter"

    class TextSplitExecutor:  # type: ignore[no-redef]
        node_type = "text-split"

    class TypeConverterExecutor:  # type: ignore[no-redef]
        node_type = "type-converter"

    class HttpRequestExecutor:  # type: ignore[no-redef]
        node_type = "http-request"


_skip_future = pytest.mark.skipif(
    not _FUTURE_EXECUTORS_AVAILABLE,
    reason="Phase 5+ executors not yet implemented",
)

# ── conftest re-exports ─────────────────────────────────────────────
from tests.conftest import collect_events


@pytest.fixture(autouse=True)
def _reset_run_control_state() -> Iterator[None]:
    run_control.reset_state()
    yield
    run_control.reset_state()


# ── Helpers ─────────────────────────────────────────────────────────


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
    """Construct a FlowContext with sensible defaults."""
    resolved_services = services or SimpleNamespace()
    resolved_registry = tool_registry or getattr(
        resolved_services, "tool_registry", MagicMock()
    )
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
    """Shorthand for DataValue construction."""
    return DataValue(type=type_, value=value)


# ====================================================================
# LLM Completion executor
# ====================================================================


async def _fake_astream(*tokens: str):
    """Simulate a model's async token stream."""
    for t in tokens:
        yield t


class TestLlmCompletionExecutor:
    """LLM Completion: prompt in, streamed text out."""

    @pytest.mark.asyncio
    async def test_returns_concatenated_text(self) -> None:
        executor = LlmCompletionExecutor()
        ctx = _flow_ctx()

        mock_model = MagicMock()
        mock_model.astream = lambda prompt: _fake_astream("Hello", " ", "world")

        with patch(
            "nodes.ai.llm_completion.executor.resolve_model", return_value=mock_model
        ):
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

        with patch(
            "nodes.ai.llm_completion.executor.resolve_model", return_value=mock_model
        ):
            events, result = await collect_events(
                executor.execute(
                    {"model": "openai:gpt-4o"}, {"prompt": _dv("string", "go")}, ctx
                )
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

        with patch(
            "nodes.ai.llm_completion.executor.resolve_model", return_value=mock_model
        ):
            events, _ = await collect_events(
                executor.execute(
                    {"model": "openai:gpt-4o"}, {"prompt": _dv("string", "")}, ctx
                )
            )

        assert len(events) >= 1
        assert events[0].event_type == "started"

    @pytest.mark.asyncio
    async def test_api_failure_yields_error_event(self) -> None:
        executor = LlmCompletionExecutor()
        ctx = _flow_ctx()

        async def _exploding_stream(prompt: str):
            raise RuntimeError("API down")
            yield  # make it an async generator  # noqa: E501

        mock_model = MagicMock()
        mock_model.astream = _exploding_stream

        with patch(
            "nodes.ai.llm_completion.executor.resolve_model", return_value=mock_model
        ):
            events, result = await collect_events(
                executor.execute(
                    {"model": "openai:gpt-4o"}, {"prompt": _dv("string", "")}, ctx
                )
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

        with patch(
            "nodes.ai.llm_completion.executor.resolve_model", return_value=mock_model
        ):
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

        with patch(
            "nodes.ai.llm_completion.executor.resolve_model", return_value=mock_model
        ):
            events, result = await collect_events(
                executor.execute({"model": "openai:gpt-4o"}, {}, ctx)
            )

        assert isinstance(result, ExecutionResult)
        assert result.outputs["output"].value["text"] == ""

    @pytest.mark.asyncio
    async def test_model_input_overrides_inline_model(self) -> None:
        executor = LlmCompletionExecutor()
        ctx = _flow_ctx()

        mock_model = MagicMock()
        mock_model.astream = lambda prompt: _fake_astream("ok")

        with patch(
            "nodes.ai.llm_completion.executor.resolve_model", return_value=mock_model
        ) as resolve_model_mock:
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

        with patch(
            "nodes.ai.llm_completion.executor.resolve_model", return_value=mock_model
        ):
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
    def __init__(self, chunks: list[SimpleNamespace]) -> None:
        self._chunks = chunks
        self.model: Any = None
        self.instructions: list[str] | None = None

    def arun(self, *_args: Any, **_kwargs: Any):
        async def _stream():
            for chunk in self._chunks:
                yield chunk

        return _stream()


class _RecordingInputAgent:
    def __init__(self, final_content: str = "") -> None:
        self.final_content = final_content
        self.calls: list[dict[str, Any]] = []

    def arun(self, **kwargs: Any):
        self.calls.append(kwargs)

        async def _stream():
            yield SimpleNamespace(event="RunCompleted", content=self.final_content)

        return _stream()


class _SlowAgent:
    model: Any = None
    instructions: list[str] | None = None

    def arun(self, *_args: Any, **_kwargs: Any):
        async def _stream():
            await asyncio.sleep(0.05)
            yield SimpleNamespace(event="RunCompleted", content="late")

        return _stream()


class _ApprovalStreamingAgent:
    def __init__(self, paused_tools: list[Any], continued_chunks: list[Any]) -> None:
        self._paused_tools = paused_tools
        self._continued_chunks = continued_chunks
        self.continue_calls: list[dict[str, Any]] = []

    def arun(self, *_args: Any, **_kwargs: Any):
        async def _stream():
            yield SimpleNamespace(
                event="RunPaused",
                run_id="run-approval",
                tools=self._paused_tools,
            )

        return _stream()

    def acontinue_run(self, **kwargs: Any):
        self.continue_calls.append(kwargs)

        async def _stream():
            for chunk in self._continued_chunks:
                yield chunk

        return _stream()


class TestAgentExecutor:
    @pytest.mark.asyncio
    async def test_model_and_instructions_inputs_override_runtime_configuration(
        self,
    ) -> None:
        executor = AgentExecutor()
        fake_agent = _FakeStreamingAgent(
            [
                SimpleNamespace(event="RunContent", content="ok"),
                SimpleNamespace(event="RunCompleted", content=""),
            ]
        )
        ctx = _flow_ctx()

        build_runnable = AsyncMock(return_value=fake_agent)
        with patch(
            "nodes.core.agent.executor._build_runtime_runnable",
            new=build_runnable,
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

        assert build_runnable.await_count == 1
        await_args = build_runnable.await_args
        assert await_args is not None
        assert await_args.kwargs["model_str"] == "google:gemini-2.5-flash"
        assert await_args.kwargs["temperature"] == 0.3
        assert await_args.kwargs["instructions"] == ["be concise"]

    @pytest.mark.asyncio
    async def test_agent_uses_agno_messages_from_data_channel(self) -> None:
        executor = AgentExecutor()
        recording_agent = _RecordingInputAgent()
        ctx = _flow_ctx()

        agno_messages = [Message(role="user", content="chat message")]

        with patch(
            "nodes.core.agent.executor._build_runtime_runnable",
            new=AsyncMock(return_value=recording_agent),
        ):
            _, result = await collect_events(
                executor.execute(
                    {"model": "openai:gpt-4o"},
                    {
                        "input": _dv(
                            "data",
                            {
                                "message": "pipeline message",
                                "agno_messages": agno_messages,
                            },
                        )
                    },
                    ctx,
                )
            )

        assert isinstance(result, ExecutionResult)
        assert len(recording_agent.calls) == 1
        run_input = recording_agent.calls[0]["input"]
        assert isinstance(run_input, list)
        assert len(run_input) == 1
        assert run_input[0].role == "user"
        assert run_input[0].content == "chat message"

    @pytest.mark.asyncio
    async def test_agent_accepts_messages_key_from_data_channel(self) -> None:
        executor = AgentExecutor()
        recording_agent = _RecordingInputAgent()
        ctx = _flow_ctx()

        with patch(
            "nodes.core.agent.executor._build_runtime_runnable",
            new=AsyncMock(return_value=recording_agent),
        ):
            _, result = await collect_events(
                executor.execute(
                    {"model": "openai:gpt-4o"},
                    {
                        "input": _dv(
                            "data",
                            {
                                "message": "from upstream",
                                "messages": [
                                    {"role": "user", "content": "first"},
                                    {"role": "assistant", "content": "second"},
                                ],
                            },
                        )
                    },
                    ctx,
                )
            )

        assert isinstance(result, ExecutionResult)
        assert len(recording_agent.calls) == 1
        run_input = recording_agent.calls[0]["input"]
        assert isinstance(run_input, list)
        assert [message.role for message in run_input] == ["user", "assistant"]
        assert [message.content for message in run_input] == ["first", "second"]

    @pytest.mark.asyncio
    async def test_agent_falls_back_to_upstream_message_when_no_messages_resolve(
        self,
    ) -> None:
        executor = AgentExecutor()
        recording_agent = _RecordingInputAgent()
        ctx = _flow_ctx()

        with patch(
            "nodes.core.agent.executor._build_runtime_runnable",
            new=AsyncMock(return_value=recording_agent),
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
        assert recording_agent.calls[0]["input"] == "from upstream"

    @pytest.mark.asyncio
    async def test_materialize_resolves_runtime_link_dependencies(self) -> None:
        executor = AgentExecutor()
        child_agent = Agent(
            name="Child",
            model="openai:gpt-4o-mini",
            markdown=True,
            stream_events=True,
            db=InMemoryDb(),
        )
        runtime = MagicMock()
        runtime.resolve_links = AsyncMock(return_value=[MagicMock(), child_agent])
        ctx = _flow_ctx(runtime=runtime)

        with patch(
            "nodes.core.agent.executor.get_model", return_value="openai:gpt-4o-mini"
        ):
            runnable = await executor.materialize(
                {"model": "openai:gpt-4o"},
                "input",
                ctx,
            )

        assert isinstance(runnable, Team)
        runtime.resolve_links.assert_awaited_once_with("test-node", "tools")
        assert child_agent in runnable.members
        assert runnable.tools is not None
        assert len(runnable.tools) == 1

    @pytest.mark.asyncio
    async def test_materialize_flattens_nested_link_artifacts_in_agent_executor(
        self,
    ) -> None:
        executor = AgentExecutor()
        child_agent = Agent(
            name="Child",
            model="openai:gpt-4o-mini",
            markdown=True,
            stream_events=True,
            db=InMemoryDb(),
        )
        runtime = MagicMock()
        runtime.resolve_links = AsyncMock(return_value=[["tool-a"], child_agent])
        runtime.incoming_edges.return_value = []
        ctx = _flow_ctx(runtime=runtime)

        with patch(
            "nodes.core.agent.executor.get_model", return_value="openai:gpt-4o-mini"
        ):
            runnable = await executor.materialize(
                {"model": "openai:gpt-4o"},
                "input",
                ctx,
            )

        assert isinstance(runnable, Team)
        assert runnable.tools == ["tool-a"]
        assert child_agent in runnable.members

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
            if (
                node_id == "test-node"
                and channel == "flow"
                and target_handle == "model"
            ):
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
    async def test_materialize_includes_extra_tool_ids_from_services(self) -> None:
        executor = AgentExecutor()
        runtime = MagicMock()
        runtime.resolve_links = AsyncMock(return_value=[])
        runtime.incoming_edges.return_value = []

        tool_registry = MagicMock()
        tool_registry.resolve_tool_ids.return_value = [MagicMock()]
        ctx = _flow_ctx(
            runtime=runtime,
            tool_registry=tool_registry,
            services=SimpleNamespace(extra_tool_ids=["mcp:github"]),
        )

        with patch(
            "nodes.core.agent.executor.get_model", return_value="openai:gpt-4o-mini"
        ):
            runnable = await executor.materialize(
                {"model": "openai:gpt-4o"},
                "input",
                ctx,
            )

        tool_registry.resolve_tool_ids.assert_called_once_with(
            ["mcp:github"],
            chat_id=ctx.chat_id,
        )
        assert runnable.tools is not None
        assert len(runnable.tools) == 1

    @pytest.mark.asyncio
    async def test_materialize_skips_extra_tools_when_chat_start_disables_them(
        self,
    ) -> None:
        executor = AgentExecutor()
        runtime = MagicMock()
        runtime.resolve_links = AsyncMock(return_value=[])

        def _incoming_edges(
            node_id: str,
            *,
            channel: str | None = None,
            target_handle: str | None = None,
        ) -> list[dict[str, str]]:
            del node_id
            if channel == "flow" and target_handle == "input":
                return [{"source": "chat-start-1"}]
            return []

        runtime.incoming_edges.side_effect = _incoming_edges
        runtime.get_node.return_value = {
            "id": "chat-start-1",
            "type": "chat-start",
            "data": {"includeUserTools": False},
        }

        tool_registry = MagicMock()
        ctx = _flow_ctx(
            runtime=runtime,
            tool_registry=tool_registry,
            services=SimpleNamespace(extra_tool_ids=["mcp:github"]),
        )

        with patch(
            "nodes.core.agent.executor.get_model", return_value="openai:gpt-4o-mini"
        ):
            runnable = await executor.materialize(
                {"model": "openai:gpt-4o"},
                "input",
                ctx,
            )

        tool_registry.resolve_tool_ids.assert_not_called()
        assert not runnable.tools

    @pytest.mark.asyncio
    async def test_materialize_uses_chat_scope_for_extra_tool_policy(self) -> None:
        executor = AgentExecutor()
        runtime = MagicMock()
        runtime.resolve_links = AsyncMock(return_value=[])
        runtime.incoming_edges.return_value = []

        tool_registry = MagicMock()
        ctx = _flow_ctx(
            runtime=runtime,
            tool_registry=tool_registry,
            services=SimpleNamespace(
                extra_tool_ids=["mcp:github"],
                chat_scope=SimpleNamespace(include_user_tools=lambda _node_id: False),
            ),
        )

        with patch(
            "nodes.core.agent.executor.get_model", return_value="openai:gpt-4o-mini"
        ):
            runnable = await executor.materialize(
                {"model": "openai:gpt-4o"},
                "input",
                ctx,
            )

        tool_registry.resolve_tool_ids.assert_not_called()
        assert not runnable.tools

    @pytest.mark.asyncio
    async def test_timeout_emits_error_event(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        executor = AgentExecutor()
        ctx = _flow_ctx()
        monkeypatch.setattr(
            "nodes.core.agent.executor.AGENT_STREAM_IDLE_TIMEOUT_SECONDS", 0.001
        )

        with patch(
            "nodes.core.agent.executor._build_runtime_runnable",
            new=AsyncMock(return_value=_SlowAgent()),
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
            tool_args={"query": "agno"},
        )
        fake_agent = _ApprovalStreamingAgent(
            paused_tools=[tool],
            continued_chunks=[
                SimpleNamespace(
                    event="RunContent", run_id="run-approval", content="ok"
                ),
                SimpleNamespace(
                    event="RunCompleted", run_id="run-approval", content=""
                ),
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

        with patch(
            "nodes.core.agent.executor._build_runtime_runnable",
            new=AsyncMock(return_value=fake_agent),
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
            if isinstance(e, NodeEvent)
            and e.event_type == "agent_event"
            and isinstance(e.data, dict)
        ]

        assert "ToolApprovalRequired" in agent_events
        assert "ToolApprovalResolved" in agent_events
        assert isinstance(final, ExecutionResult)
        assert final.outputs["output"].value["response"] == "ok"

        assert len(fake_agent.continue_calls) == 1
        continue_call = fake_agent.continue_calls[0]
        assert continue_call["run_id"] == "run-approval"
        updated_tools = continue_call["updated_tools"]
        assert len(updated_tools) == 1
        assert updated_tools[0].confirmed is True
        assert updated_tools[0].tool_args == {"query": "updated"}


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
        runtime.incoming_edges.return_value = [
            {"source": "model-0", "sourceHandle": "model"}
        ]
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


# ====================================================================
# Prompt Template executor
# ====================================================================


class TestPromptTemplateExecutor:
    """Prompt Template: variable interpolation into a template string."""

    @pytest.mark.asyncio
    async def test_renders_variables_from_input(self) -> None:
        executor = PromptTemplateExecutor()
        result = await executor.execute(
            {"template": "Hello, {{name}}! You are {{age}} years old."},
            {"input": _dv("data", {"name": "Alice", "age": 30})},
            _flow_ctx(),
        )

        assert isinstance(result, ExecutionResult)
        assert (
            result.outputs["output"].value["text"]
            == "Hello, Alice! You are 30 years old."
        )

    @pytest.mark.asyncio
    async def test_undefined_variable_empty_mode(self) -> None:
        executor = PromptTemplateExecutor()
        result = await executor.execute(
            {
                "template": "Hi {{name}}, your id is {{id}}",
                "undefinedBehavior": "empty",
            },
            {"input": _dv("data", {"name": "Bob"})},
            _flow_ctx(),
        )

        assert result.outputs["output"].value["text"] == "Hi Bob, your id is "

    @pytest.mark.asyncio
    async def test_undefined_variable_keep_mode(self) -> None:
        executor = PromptTemplateExecutor()
        result = await executor.execute(
            {"template": "Hi {{name}}, your id is {{id}}", "undefinedBehavior": "keep"},
            {"input": _dv("data", {"name": "Bob"})},
            _flow_ctx(),
        )

        assert result.outputs["output"].value["text"] == "Hi Bob, your id is {{id}}"

    @pytest.mark.asyncio
    async def test_undefined_variable_error_mode(self) -> None:
        executor = PromptTemplateExecutor()

        with pytest.raises(Exception, match="id"):
            await executor.execute(
                {"template": "{{id}}", "undefinedBehavior": "error"},
                {"input": _dv("data", {})},
                _flow_ctx(),
            )

    @pytest.mark.asyncio
    async def test_json_output_format(self) -> None:
        executor = PromptTemplateExecutor()
        result = await executor.execute(
            {"template": '{"key": "{{val}}"}', "outputFormat": "json"},
            {"input": _dv("data", {"val": "hello"})},
            _flow_ctx(),
        )

        parsed = json.loads(result.outputs["output"].value["text"])
        assert parsed == {"key": "hello"}

    @pytest.mark.asyncio
    async def test_empty_template_returns_empty(self) -> None:
        executor = PromptTemplateExecutor()
        result = await executor.execute(
            {"template": ""},
            {"input": _dv("data", {"x": 1})},
            _flow_ctx(),
        )

        assert result.outputs["output"].value["text"] == ""


# ====================================================================
# Conditional executor
# ====================================================================


class TestConditionalExecutor:
    """Conditional: evaluate condition, route data to true/false port."""

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

    def test_node_type_attribute(self) -> None:
        assert ConditionalExecutor().node_type == "conditional"


# ====================================================================
# HTTP Request executor
# ====================================================================


@_skip_future
class TestHttpRequestExecutor:
    """HTTP Request: async HTTP calls with streaming events."""

    @pytest.mark.asyncio
    async def test_get_200_returns_response_and_status(self) -> None:
        executor = HttpRequestExecutor()

        mock_response = MagicMock()
        mock_response.is_success = True
        mock_response.status_code = 200
        mock_response.json.return_value = {"data": "ok"}

        mock_client = AsyncMock()
        mock_client.request.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("httpx.AsyncClient", return_value=mock_client):
            events, result = await collect_events(
                executor.execute(
                    {"url": "https://api.example.com", "method": "GET"},
                    {},
                    _flow_ctx(),
                )
            )

        assert isinstance(result, ExecutionResult)
        assert result.outputs["response"].value == {"data": "ok"}
        assert result.outputs["status"].value == 200

    @pytest.mark.asyncio
    async def test_post_sends_body_from_input(self) -> None:
        executor = HttpRequestExecutor()
        body_payload = {"key": "value"}

        mock_response = MagicMock()
        mock_response.is_success = True
        mock_response.status_code = 201
        mock_response.json.return_value = {"created": True}

        mock_client = AsyncMock()
        mock_client.request.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("httpx.AsyncClient", return_value=mock_client):
            await collect_events(
                executor.execute(
                    {"url": "https://api.example.com", "method": "POST"},
                    {"body": _dv("json", body_payload)},
                    _flow_ctx(),
                )
            )

        _, kwargs = mock_client.request.call_args
        assert kwargs.get("json") == body_payload

    @pytest.mark.asyncio
    async def test_non_2xx_yields_error_output(self) -> None:
        executor = HttpRequestExecutor()

        mock_response = MagicMock()
        mock_response.is_success = False
        mock_response.status_code = 404
        mock_response.text = "Not Found"

        mock_client = AsyncMock()
        mock_client.request.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("httpx.AsyncClient", return_value=mock_client):
            events, result = await collect_events(
                executor.execute(
                    {"url": "https://api.example.com/missing", "method": "GET"},
                    {},
                    _flow_ctx(),
                )
            )

        assert isinstance(result, ExecutionResult)
        assert "error" in result.outputs
        assert result.outputs["error"].value["status"] == 404
        assert "response" not in result.outputs

    @pytest.mark.asyncio
    async def test_timeout_yields_error_output(self) -> None:
        import httpx

        executor = HttpRequestExecutor()

        mock_client = AsyncMock()
        mock_client.request.side_effect = httpx.TimeoutException("timed out")
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("httpx.AsyncClient", return_value=mock_client):
            events, result = await collect_events(
                executor.execute(
                    {"url": "https://slow.example.com", "method": "GET", "timeout": 1},
                    {},
                    _flow_ctx(),
                )
            )

        assert isinstance(result, ExecutionResult)
        assert "error" in result.outputs

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "method",
        ["GET", "POST", "PUT", "PATCH", "DELETE"],
    )
    async def test_all_http_methods(self, method: str) -> None:
        executor = HttpRequestExecutor()

        mock_response = MagicMock()
        mock_response.is_success = True
        mock_response.status_code = 200
        mock_response.json.return_value = {}

        mock_client = AsyncMock()
        mock_client.request.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("httpx.AsyncClient", return_value=mock_client):
            await collect_events(
                executor.execute(
                    {"url": "https://api.example.com", "method": method},
                    {},
                    _flow_ctx(),
                )
            )

        args, _ = mock_client.request.call_args
        assert args[0] == method

    @pytest.mark.asyncio
    async def test_started_event_includes_method_and_url(self) -> None:
        executor = HttpRequestExecutor()

        mock_response = MagicMock()
        mock_response.is_success = True
        mock_response.status_code = 200
        mock_response.json.return_value = {}

        mock_client = AsyncMock()
        mock_client.request.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("httpx.AsyncClient", return_value=mock_client):
            events, _ = await collect_events(
                executor.execute(
                    {"url": "https://api.test.com/v1", "method": "POST"},
                    {},
                    _flow_ctx(),
                )
            )

        started = [e for e in events if e.event_type == "started"]
        assert len(started) == 1
        assert started[0].data["method"] == "POST"
        assert started[0].data["url"] == "https://api.test.com/v1"

    def test_node_type_attribute(self) -> None:
        assert HttpRequestExecutor().node_type == "http-request"


# ====================================================================
# Filter executor
# ====================================================================


@_skip_future
class TestFilterExecutor:
    """Filter: split array into pass/reject based on condition."""

    @pytest.mark.asyncio
    async def test_array_filtering_splits_pass_reject(self) -> None:
        executor = FilterExecutor()
        items = [
            {"name": "Alice", "age": 30},
            {"name": "Bob", "age": 17},
            {"name": "Charlie", "age": 25},
        ]

        result = await executor.execute(
            {"field": "age", "operator": "greaterThan", "value": 18},
            {"input": _dv("array", items)},
            _flow_ctx(),
        )

        assert isinstance(result, ExecutionResult)
        assert len(result.outputs["pass"].value) == 2
        assert len(result.outputs["reject"].value) == 1
        assert result.outputs["reject"].value[0]["name"] == "Bob"

    @pytest.mark.asyncio
    async def test_all_match_reject_empty(self) -> None:
        executor = FilterExecutor()
        items = [{"x": 10}, {"x": 20}]

        result = await executor.execute(
            {"field": "x", "operator": "greaterThan", "value": 0},
            {"input": _dv("array", items)},
            _flow_ctx(),
        )

        assert len(result.outputs["pass"].value) == 2
        assert len(result.outputs["reject"].value) == 0

    @pytest.mark.asyncio
    async def test_none_match_pass_empty(self) -> None:
        executor = FilterExecutor()
        items = [{"x": 1}, {"x": 2}]

        result = await executor.execute(
            {"field": "x", "operator": "greaterThan", "value": 100},
            {"input": _dv("array", items)},
            _flow_ctx(),
        )

        assert len(result.outputs["pass"].value) == 0
        assert len(result.outputs["reject"].value) == 2

    @pytest.mark.asyncio
    async def test_single_object_routes_to_pass(self) -> None:
        executor = FilterExecutor()

        result = await executor.execute(
            {"field": "active", "operator": "equals", "value": True},
            {"input": _dv("json", {"active": True, "name": "test"})},
            _flow_ctx(),
        )

        assert "pass" in result.outputs

    @pytest.mark.asyncio
    async def test_single_object_routes_to_reject(self) -> None:
        executor = FilterExecutor()

        result = await executor.execute(
            {"field": "active", "operator": "equals", "value": True},
            {"input": _dv("json", {"active": False, "name": "test"})},
            _flow_ctx(),
        )

        assert "reject" in result.outputs

    def test_node_type_attribute(self) -> None:
        assert FilterExecutor().node_type == "filter"


# ====================================================================
# Type Converter executor
# ====================================================================


@_skip_future
class TestTypeConverterExecutor:
    """Type Converter: explicit type coercion between socket types."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "from_type, from_val, to_type, expected_val",
        [
            ("string", "42", "int", 42),
            ("string", "3.14", "float", 3.14),
            ("string", "true", "boolean", True),
            ("string", "false", "boolean", False),
            ("string", '{"a":1}', "json", {"a": 1}),
            ("int", 42, "string", "42"),
            ("int", 42, "float", 42.0),
            ("int", 1, "boolean", True),
            ("int", 0, "boolean", False),
            ("float", 3.14, "string", "3.14"),
            ("float", 3.0, "int", 3),
            ("boolean", True, "string", "true"),
            ("boolean", False, "string", "false"),
            ("boolean", True, "int", 1),
            ("boolean", False, "int", 0),
            ("json", {"a": 1}, "string", '{"a": 1}'),
            ("json", [1, 2], "string", "[1, 2]"),
            ("json", [1, 2], "array", [1, 2]),
        ],
        ids=[
            "str->int",
            "str->float",
            "str->bool-true",
            "str->bool-false",
            "str->json",
            "int->str",
            "int->float",
            "int->bool-true",
            "int->bool-false",
            "float->str",
            "float->int",
            "bool->str-true",
            "bool->str-false",
            "bool->int-true",
            "bool->int-false",
            "json->str-obj",
            "json->str-arr",
            "json->array",
        ],
    )
    async def test_conversion_path(
        self,
        from_type: str,
        from_val: Any,
        to_type: str,
        expected_val: Any,
    ) -> None:
        executor = TypeConverterExecutor()
        result = await executor.execute(
            {"targetType": to_type},
            {"input": _dv(from_type, from_val)},
            _flow_ctx(),
        )

        assert isinstance(result, ExecutionResult)
        assert result.outputs["output"].value == expected_val
        assert result.outputs["output"].type == to_type

    @pytest.mark.asyncio
    async def test_invalid_conversion_raises_error(self) -> None:
        executor = TypeConverterExecutor()

        with pytest.raises(Exception):
            await executor.execute(
                {"targetType": "int"},
                {"input": _dv("string", "not-a-number")},
                _flow_ctx(),
            )

    def test_node_type_attribute(self) -> None:
        assert TypeConverterExecutor().node_type == "type-converter"


# ====================================================================
# Text Split executor
# ====================================================================


@_skip_future
class TestTextSplitExecutor:
    """Text Split: split, chunk, or join text."""

    @pytest.mark.asyncio
    async def test_split_by_delimiter(self) -> None:
        executor = TextSplitExecutor()
        result = await executor.execute(
            {"mode": "split", "delimiter": ","},
            {"input": _dv("text", "a,b,c")},
            _flow_ctx(),
        )

        assert isinstance(result, ExecutionResult)
        assert result.outputs["output"].value == ["a", "b", "c"]

    @pytest.mark.asyncio
    async def test_split_by_chunk_size_with_overlap(self) -> None:
        executor = TextSplitExecutor()
        result = await executor.execute(
            {"mode": "chunk", "chunkSize": 5, "overlap": 2},
            {"input": _dv("text", "abcdefghij")},
            _flow_ctx(),
        )

        chunks = result.outputs["output"].value
        assert isinstance(chunks, list)
        assert len(chunks) >= 2
        # First chunk is 5 chars
        assert chunks[0] == "abcde"
        # Second chunk starts 3 chars in (5 - 2 overlap)
        assert chunks[1] == "defgh"

    @pytest.mark.asyncio
    async def test_join_mode(self) -> None:
        executor = TextSplitExecutor()
        result = await executor.execute(
            {"mode": "join", "delimiter": " | "},
            {"input": _dv("array", ["hello", "world"])},
            _flow_ctx(),
        )

        assert result.outputs["output"].value == "hello | world"
        assert result.outputs["output"].type == "text"

    @pytest.mark.asyncio
    async def test_auto_detect_mode(self) -> None:
        """Auto mode: if input is text, split by newline. If array, join."""
        executor = TextSplitExecutor()

        # Text input → split
        result = await executor.execute(
            {"mode": "auto"},
            {"input": _dv("text", "line1\nline2\nline3")},
            _flow_ctx(),
        )
        assert result.outputs["output"].value == ["line1", "line2", "line3"]

    @pytest.mark.asyncio
    async def test_empty_string_split(self) -> None:
        executor = TextSplitExecutor()
        result = await executor.execute(
            {"mode": "split", "delimiter": ","},
            {"input": _dv("text", "")},
            _flow_ctx(),
        )

        # Splitting empty string gives [""] or [] depending on implementation
        output = result.outputs["output"].value
        assert isinstance(output, list)

    def test_node_type_attribute(self) -> None:
        assert TextSplitExecutor().node_type == "text-split"
