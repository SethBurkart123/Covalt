from __future__ import annotations

from typing import Any

from .. import db


def _load_chat_config(sess: Any, chat_id: str) -> dict[str, Any]:
    config = db.get_chat_agent_config(sess, chat_id)
    if isinstance(config, dict):
        return config
    return db.get_default_agent_config()


def update_chat_tool_ids(chat_id: str, tool_ids: list[str]) -> None:
    with db.db_session() as sess:
        config = _load_chat_config(sess, chat_id)
        config["tool_ids"] = tool_ids
        db.update_chat_agent_config(sess, chatId=chat_id, config=config)


def update_chat_model_provider(chat_id: str, provider: str, model_id: str) -> None:
    with db.db_session() as sess:
        config = _load_chat_config(sess, chat_id)
        config["provider"] = provider
        config["model_id"] = model_id
        config.pop("agent_id", None)
        db.update_chat_agent_config(sess, chatId=chat_id, config=config)
