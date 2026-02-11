"""Tests for handle_flow_stream — the bridge between the flow engine and WebSocket.

Uses stub executors (no real LLM calls) to verify:
  - NodeEvents are forwarded as ChatEvents over the channel
  - Content blocks are built and saved correctly
  - Streaming tokens accumulate as text blocks
  - Errors propagate correctly
  - Final output is captured when no streaming happened
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from nodes._types import DataValue, ExecutionResult, FlowContext, NodeEvent
from tests.conftest import make_node, make_edge, make_graph


# ── Stub executors ───────────────────────────────────────────────────


class ChatStartStub:
    node_type = "chat-start"

    async def execute(
        self, data: dict, inputs: dict[str, DataValue], context: FlowContext
    ) -> ExecutionResult:
        msg = getattr(context.state, "user_message", "hello")
        return ExecutionResult(outputs={"output": DataValue("data", {"message": msg})})


class EchoStub:
    """Simple node that echoes input with a prefix. Non-streaming."""

    node_type = "echo"

    async def execute(
        self, data: dict, inputs: dict[str, DataValue], context: FlowContext
    ) -> ExecutionResult:
        raw = inputs.get("input", DataValue("data", {})).value
        if isinstance(raw, dict):
            text = raw.get("text", raw.get("message", str(raw)))
        else:
            text = str(raw)
        return ExecutionResult(
            outputs={"output": DataValue("data", {"text": f"echo: {text}"})}
        )


class ZeroResponseStub:
    """Returns a falsy numeric response in the data spine."""

    node_type = "zero-response"

    async def execute(
        self, data: dict, inputs: dict[str, DataValue], context: FlowContext
    ) -> ExecutionResult:
        return ExecutionResult(outputs={"output": DataValue("data", {"response": 0})})


class StreamingStub:
    """Emits progress events (simulating token streaming) then a result."""

    node_type = "streaming"

    async def execute(
        self, data: dict, inputs: dict[str, DataValue], context: FlowContext
    ):
        raw = inputs.get("input", DataValue("data", {})).value
        if isinstance(raw, dict):
            text = raw.get("text", raw.get("message", str(raw)))
        else:
            text = str(raw)

        yield NodeEvent(
            node_id=context.node_id,
            node_type=self.node_type,
            event_type="started",
            run_id=context.run_id,
        )

        for word in str(text).split():
            yield NodeEvent(
                node_id=context.node_id,
                node_type=self.node_type,
                event_type="progress",
                run_id=context.run_id,
                data={"token": word + " "},
            )

        yield ExecutionResult(
            outputs={"output": DataValue("data", {"text": str(text).upper()})}
        )


class FailingStub:
    """Always raises an exception."""

    node_type = "failing"

    async def execute(
        self, data: dict, inputs: dict[str, DataValue], context: FlowContext
    ) -> ExecutionResult:
        raise RuntimeError("intentional failure")


STUBS = {
    cls.node_type: cls()
    for cls in [
        ChatStartStub,
        EchoStub,
        ZeroResponseStub,
        StreamingStub,
        FailingStub,
    ]
}


# ── Helpers ──────────────────────────────────────────────────────────

_STREAM_MODULE = "backend.commands.streaming"


def _make_chat_message(content: str = "test message") -> MagicMock:
    msg = MagicMock()
    msg.role = "user"
    msg.content = content
    msg.id = "msg-1"
    return msg


def _make_channel() -> MagicMock:
    ch = MagicMock()
    ch.send_model = MagicMock()
    return ch


def _collect_events(channel: MagicMock) -> list[dict]:
    """Extract all ChatEvent dicts sent through channel.send_model."""
    events = []
    for call in channel.send_model.call_args_list:
        event = call[0][0]
        if hasattr(event, "model_dump"):
            events.append(event.model_dump())
        elif hasattr(event, "dict"):
            events.append(event.dict())
        else:
            events.append({"event": str(event)})
    return events


def _event_names(channel: MagicMock) -> list[str]:
    return [e.get("event", "") for e in _collect_events(channel)]


@contextmanager
def _patched_env():
    """Patch DB/broadcaster and wire run_flow to use our stubs."""
    from backend.services.flow_executor import run_flow as real_run_flow

    async def stubbed_run_flow(graph_data, context, **kwargs):
        async for item in real_run_flow(graph_data, context, executors=STUBS):
            yield item

    with (
        patch(f"{_STREAM_MODULE}.broadcaster", MagicMock()),
        patch(f"{_STREAM_MODULE}.save_msg_content", MagicMock()),
        patch(f"{_STREAM_MODULE}.load_initial_content", return_value=[]),
        patch(f"{_STREAM_MODULE}.db", MagicMock()),
        patch(f"{_STREAM_MODULE}.run_flow", side_effect=stubbed_run_flow),
    ):
        yield


# ── Tests ────────────────────────────────────────────────────────────


class TestFlowStreamingBasic:
    """Basic flow streaming: ChatStart -> Echo, non-streaming."""

    def _build_graph(self):
        return make_graph(
            nodes=[
                make_node("cs", "chat-start"),
                make_node("echo", "echo"),
            ],
            edges=[make_edge("cs", "echo", "output", "input")],
        )

    @pytest.mark.asyncio
    async def test_non_streaming_flow_sends_completed(self):
        """Non-streaming flow should emit RunCompleted."""
        from backend.commands.streaming import handle_flow_stream

        with _patched_env():
            channel = _make_channel()
            await handle_flow_stream(
                self._build_graph(),
                None,
                [_make_chat_message("hello world")],
                "asst-1",
                channel,
            )

        assert "RunCompleted" in _event_names(channel)

    @pytest.mark.asyncio
    async def test_non_streaming_flow_emits_final_text(self):
        """When no streaming tokens, the final output becomes RunContent."""
        from backend.commands.streaming import handle_flow_stream

        with _patched_env():
            channel = _make_channel()
            await handle_flow_stream(
                self._build_graph(),
                None,
                [_make_chat_message("hello world")],
                "asst-1",
                channel,
            )

        all_events = _collect_events(channel)
        content_events = [e for e in all_events if e.get("event") == "RunContent"]
        assert len(content_events) >= 1
        all_content = "".join(e.get("content", "") for e in content_events)
        assert "echo:" in all_content

    @pytest.mark.asyncio
    async def test_non_streaming_falsy_output_is_emitted(self):
        """Data outputs like 0 should still be emitted as final text."""
        from backend.commands.streaming import handle_flow_stream

        graph = make_graph(
            nodes=[
                make_node("cs", "chat-start"),
                make_node("zr", "zero-response"),
            ],
            edges=[make_edge("cs", "zr", "output", "input")],
        )

        with _patched_env():
            channel = _make_channel()
            await handle_flow_stream(
                graph,
                None,
                [_make_chat_message("ignored")],
                "asst-1",
                channel,
            )

        content_events = [
            e for e in _collect_events(channel) if e.get("event") == "RunContent"
        ]
        assert any(e.get("content") == "0" for e in content_events)


class TestFlowStreamingTokens:
    """Flow with streaming node: ChatStart -> StreamingStub."""

    def _build_graph(self):
        return make_graph(
            nodes=[
                make_node("cs", "chat-start"),
                make_node("stream", "streaming"),
            ],
            edges=[make_edge("cs", "stream", "output", "input")],
        )

    @pytest.mark.asyncio
    async def test_streaming_tokens_forwarded(self):
        """Each progress token should produce a RunContent ChatEvent."""
        from backend.commands.streaming import handle_flow_stream

        with _patched_env():
            channel = _make_channel()
            await handle_flow_stream(
                self._build_graph(),
                None,
                [_make_chat_message("hello world")],
                "asst-1",
                channel,
            )

        all_events = _collect_events(channel)
        content_events = [e for e in all_events if e.get("event") == "RunContent"]
        # StreamingStub yields "hello " and "world " as tokens
        assert len(content_events) >= 2

        events = _event_names(channel)
        assert "FlowNodeStarted" in events
        assert "RunCompleted" in events


class TestFlowStreamingError:
    """Flow with a failing node: ChatStart -> FailingStub."""

    def _build_graph(self):
        return make_graph(
            nodes=[
                make_node("cs", "chat-start"),
                make_node("fail", "failing"),
            ],
            edges=[make_edge("cs", "fail", "output", "input")],
        )

    @pytest.mark.asyncio
    async def test_error_produces_error_event(self):
        """When a node fails, an error event should be sent."""
        from backend.commands.streaming import handle_flow_stream

        with _patched_env():
            channel = _make_channel()
            await handle_flow_stream(
                self._build_graph(),
                None,
                [_make_chat_message("hello")],
                "asst-1",
                channel,
            )

        events = _event_names(channel)
        assert "RunError" in events
        assert "RunCompleted" not in events


class TestFlowStreamingEmpty:
    """Flow with no flow nodes — should complete immediately."""

    @pytest.mark.asyncio
    async def test_empty_flow_completes(self):
        from backend.commands.streaming import handle_flow_stream

        with _patched_env():
            channel = _make_channel()
            await handle_flow_stream(
                make_graph(nodes=[], edges=[]),
                None,
                [_make_chat_message("hello")],
                "asst-1",
                channel,
            )

        assert "RunCompleted" in _event_names(channel)
