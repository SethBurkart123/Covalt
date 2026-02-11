"""Characterization tests for current branch command runtime behavior.

These tests freeze command-level event envelopes and streaming delegation for
continue/retry/edit flows prior to runtime unification.
"""

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
async def test_continue_message_current_event_and_delegation_shape() -> None:
    chat_id = "chat-1"
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

    fake_agent = object()
    stream_mock = AsyncMock()
    channel = CapturingChannel()
    body = branches.ContinueMessageRequest(messageId="assistant-old", chatId=chat_id)

    with (
        patch.object(branches, "db", db_mock),
        patch.object(
            branches, "create_agent_for_chat", return_value=fake_agent
        ) as create_agent,
        patch.object(branches, "handle_content_stream", new=stream_mock),
    ):
        await branches.continue_message(channel, body)

    assert extract_event_names(channel)[:2] == ["RunStarted", "AssistantMessageId"]

    events = extract_channel_events(channel)
    assert events[1]["content"] == "assistant-new"
    assert events[1]["blocks"] == [{"type": "text", "content": "partial"}]

    create_agent.assert_called_once_with(chat_id, tool_ids=[], model_id=None)
    stream_mock.assert_awaited_once()
    args = stream_mock.await_args.args
    assert args[0] is fake_agent
    assert args[2] == "assistant-new"
    assert args[3] is channel
    assert args[1][-1].role == "user"


@pytest.mark.asyncio
async def test_retry_message_current_event_and_delegation_shape() -> None:
    chat_id = "chat-2"
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
            content="try again",
            parent_message_id="root-2",
            chat_id=chat_id,
        )
    ]
    db_mock = _db_mock_for_branch(
        original_message=original,
        history=history,
        branch_ids=["assistant-retry"],
    )

    fake_agent = object()
    stream_mock = AsyncMock()
    channel = CapturingChannel()
    body = branches.RetryMessageRequest(messageId="assistant-old", chatId=chat_id)

    with (
        patch.object(branches, "db", db_mock),
        patch.object(
            branches, "create_agent_for_chat", return_value=fake_agent
        ) as create_agent,
        patch.object(branches, "handle_content_stream", new=stream_mock),
    ):
        await branches.retry_message(channel, body)

    assert extract_event_names(channel)[:2] == ["RunStarted", "AssistantMessageId"]

    events = extract_channel_events(channel)
    assert events[1]["content"] == "assistant-retry"
    assert events[1].get("blocks") is None

    create_agent.assert_called_once_with(chat_id, tool_ids=[], model_id=None)
    stream_mock.assert_awaited_once()
    args = stream_mock.await_args.args
    assert args[0] is fake_agent
    assert args[2] == "assistant-retry"
    assert args[3] is channel


@pytest.mark.asyncio
async def test_edit_user_message_current_event_and_delegation_shape() -> None:
    chat_id = "chat-3"
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
            content="previous context",
            parent_message_id=None,
            chat_id=chat_id,
        )
    ]
    db_mock = _db_mock_for_branch(
        original_message=original,
        history=history,
        branch_ids=["user-new", "assistant-new"],
    )

    fake_agent = object()
    stream_mock = AsyncMock()
    channel = CapturingChannel()
    body = branches.EditUserMessageRequest(
        messageId="user-old",
        newContent="updated prompt",
        chatId=chat_id,
    )

    with (
        patch.object(branches, "db", db_mock),
        patch.object(
            branches, "create_agent_for_chat", return_value=fake_agent
        ) as create_agent,
        patch.object(branches, "handle_content_stream", new=stream_mock),
    ):
        await branches.edit_user_message(channel, body)

    assert extract_event_names(channel)[:2] == ["RunStarted", "AssistantMessageId"]

    events = extract_channel_events(channel)
    assert events[1]["content"] == "assistant-new"

    create_agent.assert_called_once_with(chat_id, tool_ids=[], model_id=None)
    stream_mock.assert_awaited_once()
    args = stream_mock.await_args.args
    assert args[0] is fake_agent
    assert args[2] == "assistant-new"
    assert args[3] is channel

    chat_messages = args[1]
    assert chat_messages[-1].role == "user"
    assert chat_messages[-1].content == "updated prompt"
