from __future__ import annotations

from unittest.mock import MagicMock, patch

from backend.services.chat import chat_config


def _db_mock() -> tuple[MagicMock, MagicMock]:
    db_mock = MagicMock()
    sess = MagicMock()
    db_mock.db_session.return_value.__enter__.return_value = sess
    db_mock.db_session.return_value.__exit__.return_value = False
    return db_mock, sess


def test_update_chat_tool_ids_updates_config() -> None:
    db_mock, _sess = _db_mock()
    db_mock.get_chat_agent_config.return_value = {
        "provider": "openai",
        "model_id": "gpt-4o-mini",
        "tool_ids": ["old"],
    }

    with patch.object(chat_config, "db", db_mock):
        chat_config.update_chat_tool_ids("chat-1", ["tool:new"])

    _, kwargs = db_mock.update_chat_agent_config.call_args
    assert kwargs["chatId"] == "chat-1"
    assert kwargs["config"]["tool_ids"] == ["tool:new"]


def test_update_chat_selection_saves_agent_and_parameters() -> None:
    db_mock, _sess = _db_mock()

    with (
        patch.object(chat_config, "db", db_mock),
        patch.object(chat_config, "update_chat_model_selection") as update_selection,
    ):
        chat_config.update_chat_selection(
            "chat-1",
            "agent:agent-123",
            model_options={"temperature": 0.2},
            variables={"tone": "direct"},
        )

    update_selection.assert_called_once_with(
        _sess,
        "chat-1",
        "agent:agent-123",
        model_options={"temperature": 0.2},
        variables={"tone": "direct"},
    )
