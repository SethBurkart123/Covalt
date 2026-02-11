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
    db_mock.get_chat_agent_config.return_value = {}
    return db_mock


def _user_message_payload() -> list[dict[str, str]]:
    return [{"id": "u1", "role": "user", "content": "hello"}]


@pytest.mark.asyncio
async def test_stream_chat_agent_model_routes_through_graph_runtime() -> None:
    channel = MagicMock()
    body = streaming.StreamChatRequest(
        messages=_user_message_payload(),
        modelId="agent:agent-1",
        chatId="chat-1",
    )

    agent_manager = MagicMock()
    agent_manager.get_agent.return_value = {"graph_data": _graph_data()}

    flow_stream = AsyncMock()
    content_stream = AsyncMock()

    with (
        patch.object(streaming, "ensure_chat_initialized", return_value="chat-1"),
        patch.object(streaming, "save_user_msg"),
        patch.object(streaming, "init_assistant_msg", return_value="asst-1"),
        patch.object(streaming, "get_agent_manager", return_value=agent_manager),
        patch.object(
            streaming,
            "build_agent_from_graph",
            return_value=SimpleNamespace(agent=MagicMock()),
        ),
        patch.object(streaming, "handle_flow_stream", new=flow_stream),
        patch.object(streaming, "handle_content_stream", new=content_stream),
        patch.object(streaming, "db", _make_db_mock()),
    ):
        await streaming.stream_chat(channel, body)

    flow_stream.assert_awaited_once()
    content_stream.assert_not_awaited()


@pytest.mark.asyncio
async def test_stream_agent_chat_routes_through_graph_runtime() -> None:
    channel = MagicMock()
    body = streaming.StreamAgentChatRequest(
        agentId="agent-1",
        messages=_user_message_payload(),
        ephemeral=True,
    )

    agent_manager = MagicMock()
    agent_manager.get_agent.return_value = {"graph_data": _graph_data()}

    flow_stream = AsyncMock()
    content_stream = AsyncMock()

    with (
        patch.object(streaming, "get_agent_manager", return_value=agent_manager),
        patch.object(
            streaming,
            "build_agent_from_graph",
            return_value=SimpleNamespace(agent=MagicMock()),
        ),
        patch.object(streaming, "handle_flow_stream", new=flow_stream),
        patch.object(streaming, "handle_content_stream", new=content_stream),
    ):
        await streaming.stream_agent_chat(channel, body)

    flow_stream.assert_awaited_once()
    content_stream.assert_not_awaited()


@pytest.mark.asyncio
async def test_stream_chat_non_agent_model_keeps_content_stream_path() -> None:
    channel = MagicMock()
    body = streaming.StreamChatRequest(
        messages=_user_message_payload(),
        modelId="openai:gpt-4o-mini",
        chatId="chat-1",
    )

    flow_stream = AsyncMock()
    content_stream = AsyncMock()

    with (
        patch.object(streaming, "ensure_chat_initialized", return_value="chat-1"),
        patch.object(streaming, "save_user_msg"),
        patch.object(streaming, "init_assistant_msg", return_value="asst-1"),
        patch.object(streaming, "create_agent_for_chat", return_value=MagicMock()),
        patch.object(streaming, "handle_flow_stream", new=flow_stream),
        patch.object(streaming, "handle_content_stream", new=content_stream),
        patch.object(streaming, "db", _make_db_mock()),
    ):
        await streaming.stream_chat(channel, body)

    flow_stream.assert_not_awaited()
    content_stream.assert_awaited_once()
