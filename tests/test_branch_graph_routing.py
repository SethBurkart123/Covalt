from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.commands import branches
from tests.conftest import CapturingChannel, extract_channel_events, extract_event_names


def _message(
    *,
    message_id: str,
    role: str,
    content: str,
    parent_message_id: str | None,
    chat_id: str,
    created_at: str = "2026-01-01T00:00:00",
    attachments: str | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=message_id,
        role=role,
        content=content,
        parent_message_id=parent_message_id,
        chatId=chat_id,
        createdAt=created_at,
        attachments=attachments,
    )


def _db_mock_for_branch(
    *,
    original_message: SimpleNamespace,
    history: list[SimpleNamespace],
    branch_ids: list[str],
) -> MagicMock:
    db_mock = MagicMock()
    db_mock.Message = type("Message", (), {})

    session = MagicMock()
    session.get.return_value = original_message
    db_mock.db_session.return_value.__enter__.return_value = session
    db_mock.db_session.return_value.__exit__.return_value = False
    db_mock.get_message_path.return_value = history
    db_mock.create_branch_message.side_effect = branch_ids
    db_mock.get_manifest_for_message.return_value = None

    return db_mock


@pytest.mark.asyncio
async def test_continue_message_agent_model_routes_to_graph_runtime() -> None:
    chat_id = "chat-continue"
    original = _message(
        message_id="assistant-old",
        role="assistant",
        content='[{"type":"text","content":"partial"}]',
        parent_message_id="user-1",
        chat_id=chat_id,
    )
    history = [
        _message(
            message_id="user-1",
            role="user",
            content="hello",
            parent_message_id="root-1",
            chat_id=chat_id,
        )
    ]
    db_mock = _db_mock_for_branch(
        original_message=original,
        history=history,
        branch_ids=["assistant-new"],
    )

    graph_data = {
        "nodes": [{"id": "cs", "type": "chat-start", "data": {}}],
        "edges": [],
    }
    graph_runtime = AsyncMock()
    content_stream = AsyncMock()
    channel = CapturingChannel()

    body = branches.ContinueMessageRequest(
        messageId="assistant-old",
        chatId=chat_id,
        modelId="agent:agent-1",
    )

    with (
        patch.object(branches, "db", db_mock),
        patch.object(branches, "update_chat_model_selection"),
        patch.object(branches, "get_graph_data_for_chat", return_value=graph_data),
        patch.object(branches, "run_graph_chat_runtime", new=graph_runtime),
        patch.object(branches, "create_agent_for_chat") as create_agent,
        patch.object(branches, "handle_content_stream", new=content_stream),
    ):
        await branches.continue_message(channel, body)

    assert extract_event_names(channel)[:2] == ["RunStarted", "AssistantMessageId"]
    events = extract_channel_events(channel)
    assert events[1]["content"] == "assistant-new"
    assert events[1]["blocks"] == [{"type": "text", "content": "partial"}]

    graph_runtime.assert_awaited_once()
    create_agent.assert_not_called()
    content_stream.assert_not_awaited()


@pytest.mark.asyncio
async def test_retry_message_agent_model_routes_to_graph_runtime() -> None:
    chat_id = "chat-retry"
    original = _message(
        message_id="assistant-old",
        role="assistant",
        content="old answer",
        parent_message_id="user-2",
        chat_id=chat_id,
    )
    history = [
        _message(
            message_id="user-2",
            role="user",
            content="retry this",
            parent_message_id="root-2",
            chat_id=chat_id,
        )
    ]
    db_mock = _db_mock_for_branch(
        original_message=original,
        history=history,
        branch_ids=["assistant-retry"],
    )

    graph_data = {
        "nodes": [{"id": "cs", "type": "chat-start", "data": {}}],
        "edges": [],
    }
    graph_runtime = AsyncMock()
    content_stream = AsyncMock()
    channel = CapturingChannel()

    body = branches.RetryMessageRequest(
        messageId="assistant-old",
        chatId=chat_id,
        modelId="agent:agent-1",
    )

    with (
        patch.object(branches, "db", db_mock),
        patch.object(branches, "update_chat_model_selection"),
        patch.object(branches, "get_graph_data_for_chat", return_value=graph_data),
        patch.object(branches, "run_graph_chat_runtime", new=graph_runtime),
        patch.object(branches, "create_agent_for_chat") as create_agent,
        patch.object(branches, "handle_content_stream", new=content_stream),
    ):
        await branches.retry_message(channel, body)

    assert extract_event_names(channel)[:2] == ["RunStarted", "AssistantMessageId"]
    events = extract_channel_events(channel)
    assert events[1]["content"] == "assistant-retry"

    graph_runtime.assert_awaited_once()
    create_agent.assert_not_called()
    content_stream.assert_not_awaited()


@pytest.mark.asyncio
async def test_edit_message_agent_model_routes_to_graph_runtime() -> None:
    chat_id = "chat-edit"
    original = _message(
        message_id="user-old",
        role="user",
        content="old prompt",
        parent_message_id="root-3",
        chat_id=chat_id,
        created_at="2026-01-02T00:00:00",
    )
    history = [
        _message(
            message_id="root-3",
            role="assistant",
            content="prior context",
            parent_message_id=None,
            chat_id=chat_id,
        )
    ]
    db_mock = _db_mock_for_branch(
        original_message=original,
        history=history,
        branch_ids=["user-new", "assistant-new"],
    )

    graph_data = {
        "nodes": [{"id": "cs", "type": "chat-start", "data": {}}],
        "edges": [],
    }
    graph_runtime = AsyncMock()
    content_stream = AsyncMock()
    channel = CapturingChannel()

    body = branches.EditUserMessageRequest(
        messageId="user-old",
        newContent="updated prompt",
        chatId=chat_id,
        modelId="agent:agent-1",
    )

    with (
        patch.object(branches, "db", db_mock),
        patch.object(branches, "update_chat_model_selection"),
        patch.object(branches, "get_graph_data_for_chat", return_value=graph_data),
        patch.object(branches, "run_graph_chat_runtime", new=graph_runtime),
        patch.object(branches, "create_agent_for_chat") as create_agent,
        patch.object(branches, "handle_content_stream", new=content_stream),
    ):
        await branches.edit_user_message(channel, body)

    assert extract_event_names(channel)[:2] == ["RunStarted", "AssistantMessageId"]
    events = extract_channel_events(channel)
    assert events[1]["content"] == "assistant-new"

    graph_runtime.assert_awaited_once()
    create_agent.assert_not_called()
    content_stream.assert_not_awaited()
