from __future__ import annotations

from typing import Any

import pytest

from backend.models.chat import ChatMessage
from backend.services.chat_graph_runner import run_graph_chat_runtime
from tests.conftest import CapturingChannel, make_edge, make_graph, make_node


def _graph() -> dict[str, Any]:
    return make_graph(
        nodes=[
            make_node("cs", "chat-start"),
            make_node("agent", "agent"),
        ],
        edges=[make_edge("cs", "agent", "output", "input")],
    )


@pytest.mark.asyncio
async def test_runtime_delegates_to_flow_handler_without_prebuilt_agent() -> None:
    captured: dict[str, Any] = {}

    async def fake_flow_handler(
        graph_data: dict[str, Any],
        agent: Any,
        messages: list[ChatMessage],
        assistant_msg_id: str,
        channel: Any,
        **kwargs: Any,
    ) -> None:
        captured["graph_data"] = graph_data
        captured["agent"] = agent
        captured["messages"] = messages
        captured["assistant_msg_id"] = assistant_msg_id
        captured["chat_id"] = kwargs.get("chat_id")
        captured["ephemeral"] = kwargs.get("ephemeral")

    await run_graph_chat_runtime(
        _graph(),
        [ChatMessage(id="user-1", role="user", content="hello")],
        "assistant-1",
        CapturingChannel(),
        chat_id="chat-1",
        ephemeral=True,
        extra_tool_ids=["tool:custom"],
        flow_stream_handler=fake_flow_handler,
    )

    assert captured["graph_data"]["nodes"][0]["id"] == "cs"
    assert captured["agent"] is None
    assert captured["assistant_msg_id"] == "assistant-1"
    assert captured["chat_id"] == "chat-1"
    assert captured["ephemeral"] is True


@pytest.mark.asyncio
async def test_runtime_requires_user_message() -> None:
    async def fake_flow_handler(*_args: Any, **_kwargs: Any) -> None:
        raise AssertionError("handler should not be called")

    with pytest.raises(ValueError, match="No user message found"):
        await run_graph_chat_runtime(
            _graph(),
            [],
            "assistant-1",
            CapturingChannel(),
            chat_id="chat-1",
            ephemeral=False,
            flow_stream_handler=fake_flow_handler,
        )
