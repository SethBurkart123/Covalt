from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from .models import UserSettings


def get_user_setting(sess: Session, key: str) -> Optional[str]:
    setting: Optional[UserSettings] = sess.get(UserSettings, key)
    return setting.value if setting else None


def set_user_setting(sess: Session, key: str, value: str) -> None:
    setting: Optional[UserSettings] = sess.get(UserSettings, key)

    if setting:
        setting.value = value
    else:
        sess.add(UserSettings(key=key, value=value))

    sess.commit()


def get_default_tool_ids(sess: Session) -> List[str]:
    value = get_user_setting(sess, "default_tool_ids")
    if not value:
        return []

    tool_ids = json.loads(value)
    return tool_ids if isinstance(tool_ids, list) else []


def set_default_tool_ids(sess: Session, tool_ids: List[str]) -> None:
    set_user_setting(sess, "default_tool_ids", json.dumps(tool_ids))


def get_general_settings(sess: Session) -> Dict[str, Any]:
    value = get_user_setting(sess, "general_settings")
    if not value:
        return get_default_general_settings()

    settings = json.loads(value)
    defaults = get_default_general_settings()
    for key, default_val in defaults.items():
        if key not in settings:
            settings[key] = default_val
    return settings


def update_general_settings(sess: Session, partial_settings: Dict[str, Any]) -> None:
    current = get_general_settings(sess)
    current.update(partial_settings)
    set_user_setting(sess, "general_settings", json.dumps(current))


def get_default_general_settings() -> Dict[str, Any]:
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


def get_auto_title_settings(sess: Session) -> Dict[str, Any]:
    general = get_general_settings(sess)
    return general.get("auto_title", get_default_general_settings()["auto_title"])


def save_auto_title_settings(sess: Session, settings: Dict[str, Any]) -> None:
    update_general_settings(sess, {"auto_title": settings})


def get_system_prompt_setting(sess: Session) -> str:
    general = get_general_settings(sess)
    return general.get("system_prompt", "")


def save_system_prompt_setting(sess: Session, prompt: str) -> None:
    update_general_settings(sess, {"system_prompt": prompt})
