"""Characterization tests for current branch command runtime behavior.

These tests freeze command-level event envelopes and current graph-runtime
delegation for continue/retry/edit flows.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.commands import branches
from backend.services.models import option_validation as option_validation_service
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
    db_mock.Chat = type("Chat", (), {})

    session = MagicMock()
    def _get_side_effect(model: object, _id: object):
        if model is db_mock.Message:
            return original_message
        if model is db_mock.Chat:
            return SimpleNamespace(model="openai:gpt-4o")
        return None

    session.get.side_effect = _get_side_effect

    db_mock.db_session.return_value.__enter__.return_value = session
    db_mock.db_session.return_value.__exit__.return_value = False
    db_mock.get_message_path.return_value = history
    db_mock.create_branch_message.side_effect = branch_ids
    db_mock.get_manifest_for_message.return_value = None
    db_mock.get_chat_agent_config.return_value = {
        "provider": "openai",
        "model_id": "gpt-4o",
    }

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

    graph_data = {
        "nodes": [{"id": "cs", "type": "chat-start", "data": {}}],
        "edges": [],
    }
    runtime_mock = AsyncMock()
    channel = CapturingChannel()
    body = branches.ContinueMessageRequest(message_id="assistant-old", chat_id=chat_id)

    with (
        patch.object(branches, "db", db_mock),
        patch.object(option_validation_service, "db", db_mock),
        patch.object(branches, "materialize_to_branch") as materialize_branch,
        patch.object(branches, "get_graph_data_for_chat", return_value=graph_data),
        patch.object(branches, "run_graph_chat_runtime", new=runtime_mock),
    ):
        await branches.continue_message(channel, body)

    assert db_mock.create_branch_message.call_count == 1
    call = db_mock.create_branch_message.call_args
    assert call is not None
    assert call.kwargs["parent_id"] == "user-1"
    assert call.kwargs["role"] == "assistant"
    assert call.kwargs["chat_id"] == chat_id
    assert call.kwargs["is_complete"] is False
    assert json.loads(call.kwargs["content"]) == [{"type": "text", "content": "partial"}]
    materialize_branch.assert_called_once_with(chat_id, "assistant-old")

    assert extract_event_names(channel)[:2] == ["RunStarted", "AssistantMessageId"]

    events = extract_channel_events(channel)
    assert events[1]["content"] == "assistant-new"
    assert events[1]["blocks"] == [{"type": "text", "content": "partial"}]

    runtime_mock.assert_awaited_once()
    await_args = runtime_mock.await_args
    assert await_args is not None
    args = await_args.args
    assert args[0] == graph_data
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

    graph_data = {
        "nodes": [{"id": "cs", "type": "chat-start", "data": {}}],
        "edges": [],
    }
    runtime_mock = AsyncMock()
    channel = CapturingChannel()
    body = branches.RetryMessageRequest(message_id="assistant-old", chat_id=chat_id)

    with (
        patch.object(branches, "db", db_mock),
        patch.object(option_validation_service, "db", db_mock),
        patch.object(branches, "materialize_to_branch") as materialize_branch,
        patch.object(branches, "get_graph_data_for_chat", return_value=graph_data),
        patch.object(branches, "run_graph_chat_runtime", new=runtime_mock),
    ):
        await branches.retry_message(channel, body)

    assert db_mock.create_branch_message.call_count == 1
    call = db_mock.create_branch_message.call_args
    assert call is not None
    assert call.kwargs["parent_id"] == "user-2"
    assert call.kwargs["role"] == "assistant"
    assert call.kwargs["chat_id"] == chat_id
    assert call.kwargs["is_complete"] is False
    assert call.kwargs["content"] == ""
    materialize_branch.assert_called_once_with(chat_id, "user-2")

    assert extract_event_names(channel)[:2] == ["RunStarted", "AssistantMessageId"]

    events = extract_channel_events(channel)
    assert events[1]["content"] == "assistant-retry"
    assert events[1].get("blocks") is None

    runtime_mock.assert_awaited_once()
    await_args = runtime_mock.await_args
    assert await_args is not None
    args = await_args.args
    assert args[0] == graph_data
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

    graph_data = {
        "nodes": [{"id": "cs", "type": "chat-start", "data": {}}],
        "edges": [],
    }
    runtime_mock = AsyncMock()
    channel = CapturingChannel()
    body = branches.EditUserMessageRequest(
        message_id="user-old",
        new_content="updated prompt",
        chat_id=chat_id,
    )

    with (
        patch.object(branches, "db", db_mock),
        patch.object(option_validation_service, "db", db_mock),
        patch.object(branches, "materialize_to_branch") as materialize_branch,
        patch.object(branches, "get_graph_data_for_chat", return_value=graph_data),
        patch.object(branches, "run_graph_chat_runtime", new=runtime_mock),
    ):
        await branches.edit_user_message(channel, body)

    assert db_mock.create_branch_message.call_count == 2
    user_call, assistant_call = db_mock.create_branch_message.call_args_list
    assert user_call.kwargs["parent_id"] == "root-3"
    assert user_call.kwargs["role"] == "user"
    assert user_call.kwargs["content"] == "updated prompt"
    assert user_call.kwargs["is_complete"] is True

    assert assistant_call.kwargs["parent_id"] == "user-new"
    assert assistant_call.kwargs["role"] == "assistant"
    assert assistant_call.kwargs["content"] == ""
    assert assistant_call.kwargs["is_complete"] is False

    materialize_branch.assert_called_once_with(chat_id, "user-new")

    assert extract_event_names(channel)[:2] == ["RunStarted", "AssistantMessageId"]

    events = extract_channel_events(channel)
    assert events[1]["content"] == "assistant-new"

    runtime_mock.assert_awaited_once()
    await_args = runtime_mock.await_args
    assert await_args is not None
    args = await_args.args
    assert args[0] == graph_data
    assert args[2] == "assistant-new"
    assert args[3] is channel

    chat_messages = args[1]
    assert chat_messages[-1].role == "user"
    assert chat_messages[-1].content == "updated prompt"
