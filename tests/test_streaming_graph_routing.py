from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.commands import streaming


def _graph_data() -> dict[str, object]:
    return {
        "nodes": [
            {"id": "cs", "type": "chat-start", "data": {}},
            {"id": "agent", "type": "agent", "data": {}},
        ],
        "edges": [
            {
                "id": "e1",
                "source": "cs",
                "sourceHandle": "output",
                "target": "agent",
                "targetHandle": "input",
                "data": {"channel": "flow"},
            }
        ],
    }


def _make_db_mock() -> MagicMock:
    db_mock = MagicMock()
    sess = MagicMock()
    sess.get.return_value = SimpleNamespace(active_leaf_message_id=None)
    db_mock.db_session.return_value.__enter__.return_value = sess
    db_mock.db_session.return_value.__exit__.return_value = False
    db_mock.Chat = object()
    return db_mock


def _user_message_payload() -> list[dict[str, str]]:
    return [{"id": "u1", "role": "user", "content": "hello"}]


@pytest.mark.asyncio
async def test_stream_chat_agent_model_uses_graph_runtime() -> None:
    channel = MagicMock()
    body = streaming.StreamChatRequest(
        messages=_user_message_payload(),
        modelId="agent:agent-1",
        chatId="chat-1",
    )

    graph_runtime = AsyncMock()

    with (
        patch.object(streaming, "ensure_chat_initialized", return_value="chat-1"),
        patch.object(streaming, "save_user_msg"),
        patch.object(streaming, "init_assistant_msg", return_value="asst-1"),
        patch.object(streaming, "db", _make_db_mock()),
        patch.object(streaming, "get_graph_data_for_chat", return_value=_graph_data()),
        patch.object(streaming, "run_graph_chat_runtime", new=graph_runtime),
    ):
        await streaming.stream_chat(channel, body)

    graph_runtime.assert_awaited_once()


@pytest.mark.asyncio
async def test_stream_chat_non_agent_model_uses_graph_runtime() -> None:
    channel = MagicMock()
    body = streaming.StreamChatRequest(
        messages=_user_message_payload(),
        modelId="openai:gpt-4o-mini",
        chatId="chat-1",
    )

    graph_runtime = AsyncMock()

    with (
        patch.object(streaming, "ensure_chat_initialized", return_value="chat-1"),
        patch.object(streaming, "save_user_msg"),
        patch.object(streaming, "init_assistant_msg", return_value="asst-1"),
        patch.object(streaming, "db", _make_db_mock()),
        patch.object(streaming, "get_graph_data_for_chat", return_value=_graph_data()),
        patch.object(streaming, "run_graph_chat_runtime", new=graph_runtime),
    ):
        await streaming.stream_chat(channel, body)

    graph_runtime.assert_awaited_once()


@pytest.mark.asyncio
async def test_stream_chat_preserves_historical_message_attachments() -> None:
    channel = MagicMock()
    body = streaming.StreamChatRequest(
        messages=[
            {
                "id": "u0",
                "role": "user",
                "content": "check previous screenshot",
                "attachments": [
                    {
                        "id": "att-1",
                        "type": "image",
                        "name": "screenshot.png",
                        "mimeType": "image/png",
                        "size": 123,
                    }
                ],
            },
            {"id": "u1", "role": "user", "content": "follow-up question"},
        ],
        modelId="openai:gpt-4o-mini",
        chatId="chat-1",
    )

    graph_runtime = AsyncMock()

    with (
        patch.object(streaming, "ensure_chat_initialized", return_value="chat-1"),
        patch.object(streaming, "save_user_msg"),
        patch.object(streaming, "init_assistant_msg", return_value="asst-1"),
        patch.object(streaming, "db", _make_db_mock()),
        patch.object(streaming, "get_graph_data_for_chat", return_value=_graph_data()),
        patch.object(streaming, "run_graph_chat_runtime", new=graph_runtime),
    ):
        await streaming.stream_chat(channel, body)

    graph_runtime.assert_awaited_once()
    args, kwargs = graph_runtime.await_args
    del kwargs
    forwarded_messages = args[1]
    assert forwarded_messages[0].attachments is not None
    assert forwarded_messages[0].attachments[0].name == "screenshot.png"


@pytest.mark.asyncio
async def test_stream_agent_chat_uses_graph_runtime() -> None:
    channel = MagicMock()
    body = streaming.StreamAgentChatRequest(
        agentId="agent-1",
        messages=_user_message_payload(),
        ephemeral=True,
    )

    agent_manager = MagicMock()
    agent_manager.get_agent.return_value = {"graph_data": _graph_data()}
    graph_runtime = AsyncMock()

    with (
        patch.object(streaming, "get_agent_manager", return_value=agent_manager),
        patch.object(streaming, "run_graph_chat_runtime", new=graph_runtime),
    ):
        await streaming.stream_agent_chat(channel, body)

    graph_runtime.assert_awaited_once()


@pytest.mark.asyncio
async def test_stream_agent_chat_preserves_historical_message_attachments() -> None:
    channel = MagicMock()
    body = streaming.StreamAgentChatRequest(
        agentId="agent-1",
        messages=[
            {
                "id": "u0",
                "role": "user",
                "content": "prior image",
                "attachments": [
                    {
                        "id": "att-1",
                        "type": "image",
                        "name": "diagram.png",
                        "mimeType": "image/png",
                        "size": 321,
                    }
                ],
            },
            {"id": "u1", "role": "user", "content": "what does it show?"},
        ],
        ephemeral=True,
    )

    agent_manager = MagicMock()
    agent_manager.get_agent.return_value = {"graph_data": _graph_data()}
    graph_runtime = AsyncMock()

    with (
        patch.object(streaming, "get_agent_manager", return_value=agent_manager),
        patch.object(streaming, "run_graph_chat_runtime", new=graph_runtime),
    ):
        await streaming.stream_agent_chat(channel, body)

    graph_runtime.assert_awaited_once()
    args, kwargs = graph_runtime.await_args
    del kwargs
    forwarded_messages = args[1]
    assert forwarded_messages[0].attachments is not None
    assert forwarded_messages[0].attachments[0].name == "diagram.png"
