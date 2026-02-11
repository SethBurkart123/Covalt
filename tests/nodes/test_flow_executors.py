"""TDD specs for flow node executors (execute() method).

These tests define the contract for executors that process data at runtime.
Phase 3 executors (LLM Completion, Prompt Template, Conditional) are live.
Phase 5+ executors are guarded and skipped until implemented.
"""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from typing import Any, AsyncIterator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

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


# ── Helpers ─────────────────────────────────────────────────────────


def _flow_ctx(
    *,
    node_id: str = "test-node",
    chat_id: str | None = "chat-1",
    run_id: str = "run-1",
    state: Any = None,
    agent: Any = None,
    tool_registry: Any = None,
) -> FlowContext:
    """Construct a FlowContext with sensible defaults."""
    return FlowContext(
        node_id=node_id,
        chat_id=chat_id,
        run_id=run_id,
        state=state or MagicMock(),
        agent=agent,
        tool_registry=tool_registry or MagicMock(),
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


class _SlowAgent:
    model: Any = None
    instructions: list[str] | None = None

    def arun(self, *_args: Any, **_kwargs: Any):
        async def _stream():
            await asyncio.sleep(0.05)
            yield SimpleNamespace(event="RunCompleted", content="late")

        return _stream()


class TestAgentExecutor:
    @pytest.mark.asyncio
    async def test_model_and_instructions_inputs_override_context_agent(self) -> None:
        executor = AgentExecutor()
        fake_agent = _FakeStreamingAgent(
            [
                SimpleNamespace(event="RunContent", content="ok"),
                SimpleNamespace(event="RunCompleted", content=""),
            ]
        )
        ctx = _flow_ctx(agent=fake_agent)
        resolved_model = object()

        with patch(
            "nodes.core.agent.executor.get_model", return_value=resolved_model
        ) as get_model_mock:
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
        get_model_mock.assert_called_once_with(
            "google", "gemini-2.5-flash", temperature=0.3
        )
        assert fake_agent.model is resolved_model
        assert fake_agent.instructions == ["be concise"]

    @pytest.mark.asyncio
    async def test_timeout_emits_error_event(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        executor = AgentExecutor()
        ctx = _flow_ctx(agent=_SlowAgent())
        monkeypatch.setattr(
            "nodes.core.agent.executor.AGENT_STREAM_IDLE_TIMEOUT_SECONDS", 0.001
        )

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
