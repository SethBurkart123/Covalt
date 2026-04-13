from __future__ import annotations

from typing import Any

import orjson
from sqlalchemy.orm import Session

from .models import UserSettings


def get_user_setting(sess: Session, key: str) -> str | None:
    setting: UserSettings | None = sess.get(UserSettings, key)
    return setting.value if setting else None


def set_user_setting(sess: Session, key: str, value: str) -> None:
    setting: UserSettings | None = sess.get(UserSettings, key)

    if setting:
        setting.value = value
    else:
        sess.add(UserSettings(key=key, value=value))

    sess.commit()


def get_default_tool_ids(sess: Session) -> list[str]:
    value = get_user_setting(sess, "default_tool_ids")
    if not value:
        return []

    tool_ids = orjson.loads(value)
    return tool_ids if isinstance(tool_ids, list) else []


def set_default_tool_ids(sess: Session, tool_ids: list[str]) -> None:
    set_user_setting(sess, "default_tool_ids", orjson.dumps(tool_ids).decode())


def get_general_settings(sess: Session) -> dict[str, Any]:
    value = get_user_setting(sess, "general_settings")
    if not value:
        return get_default_general_settings()

    settings = orjson.loads(value)
    defaults = get_default_general_settings()
    for key, default_val in defaults.items():
        if key not in settings:
            settings[key] = default_val
    return settings


def update_general_settings(sess: Session, partial_settings: dict[str, Any]) -> None:
    current = get_general_settings(sess)
    current.update(partial_settings)
    set_user_setting(sess, "general_settings", orjson.dumps(current).decode())


def get_default_general_settings() -> dict[str, Any]:
    return {
        "auto_title": {
            "enabled": True,
            "prompt": "Generate a brief, descriptive title (max 6 words) for this conversation based on the user's message: {{ message }}\n\nReturn only the title, nothing else.",
            "model_mode": "current",
            "provider": "openai",
            "model_id": "gpt-4o-mini",
        },
        "system_prompt": "",
    }


def get_auto_title_settings(sess: Session) -> dict[str, Any]:
    general = get_general_settings(sess)
    return general.get("auto_title", get_default_general_settings()["auto_title"])


def save_auto_title_settings(sess: Session, settings: dict[str, Any]) -> None:
    update_general_settings(sess, {"auto_title": settings})


def get_system_prompt_setting(sess: Session) -> str:
    general = get_general_settings(sess)
    return general.get("system_prompt", "")


def save_system_prompt_setting(sess: Session, prompt: str) -> None:
    update_general_settings(sess, {"system_prompt": prompt})


def get_starred_models(sess: Session) -> list[str]:
    value = get_user_setting(sess, "starred_models")
    if not value:
        return []
    parsed = orjson.loads(value)
    return parsed if isinstance(parsed, list) else []


def set_starred_models(sess: Session, model_keys: list[str]) -> None:
    set_user_setting(sess, "starred_models", orjson.dumps(model_keys).decode())


def get_selected_model(sess: Session) -> str:
    return get_user_setting(sess, "selected_model") or ""


def set_selected_model(sess: Session, model_key: str) -> None:
    set_user_setting(sess, "selected_model", model_key)


def get_recent_models(sess: Session) -> list[str]:
    value = get_user_setting(sess, "recent_models")
    if not value:
        return []
    parsed = orjson.loads(value)
    return parsed if isinstance(parsed, list) else []


def set_recent_models(sess: Session, model_keys: list[str]) -> None:
    set_user_setting(sess, "recent_models", orjson.dumps(model_keys).decode())
