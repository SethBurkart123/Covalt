from __future__ import annotations

from typing import Any, Optional

from .. import db


def parse_model_id(model_id: Optional[str]) -> tuple[str, str]:
    if not model_id:
        return "", ""
    if ":" in model_id:
        provider, model = model_id.split(":", 1)
        return provider, model
    return "", model_id


def update_chat_model_selection(sess: Any, chat_id: str, model_id: str) -> None:
    config = db.get_chat_agent_config(sess, chat_id) or {}
    if model_id.startswith("agent:"):
        config["agent_id"] = model_id[len("agent:") :]
    else:
        provider, model = parse_model_id(model_id)
        config["provider"] = provider
        config["model_id"] = model
        config.pop("agent_id", None)
    db.update_chat_agent_config(sess, chatId=chat_id, config=config)
