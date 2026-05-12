from __future__ import annotations

from typing import Any

import orjson
from sqlalchemy.orm import Session

from .models import UserSettings

MODEL_SELECTION_MODES = {"last_used", "fixed"}


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
        "output_smoothing": {
            "enabled": False,
            "delay_ms": 320,
        },
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


def get_output_smoothing_settings(sess: Session) -> dict[str, Any]:
    general = get_general_settings(sess)
    settings = general.get("output_smoothing", {})
    return {
        **get_default_general_settings()["output_smoothing"],
        **settings,
    }


def save_output_smoothing_settings(sess: Session, settings: dict[str, Any]) -> None:
    update_general_settings(sess, {"output_smoothing": settings})


def get_starred_models(sess: Session) -> list[str]:
    value = get_user_setting(sess, "starred_models")
    if not value:
        return []
    parsed = orjson.loads(value)
    return parsed if isinstance(parsed, list) else []


def set_starred_models(sess: Session, model_keys: list[str]) -> None:
    set_user_setting(sess, "starred_models", orjson.dumps(model_keys).decode())


def _selection_state_from_dict(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        value = {}
    model_key = value.get("model_key")
    model_options = value.get("model_options")
    variables = value.get("variables")
    return {
        "model_key": model_key if isinstance(model_key, str) else "",
        "model_options": model_options if isinstance(model_options, dict) else {},
        "variables": variables if isinstance(variables, dict) else {},
    }


def _json_dict_from_setting(value: str | None) -> dict[str, Any] | None:
    if not value:
        return None
    try:
        parsed = orjson.loads(value)
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    return parsed


def _selection_state_from_value(value: str | None) -> dict[str, Any] | None:
    parsed = _json_dict_from_setting(value)
    if parsed is None:
        return None
    return _selection_state_from_dict(parsed)


def get_model_selection_state(sess: Session) -> dict[str, Any]:
    state = _selection_state_from_value(get_user_setting(sess, "selected_model_state"))
    if state is not None:
        return state
    return _selection_state_from_dict({})


def set_model_selection_state(sess: Session, state: dict[str, Any]) -> None:
    payload = _selection_state_from_dict(state)
    set_user_setting(
        sess,
        "selected_model_state",
        orjson.dumps(payload).decode(),
    )


def get_model_selection_settings(sess: Session) -> dict[str, Any]:
    settings = _json_dict_from_setting(get_user_setting(sess, "model_selection_settings"))
    if settings is None:
        return {
            "mode": "last_used",
            "fixed_selection": _selection_state_from_dict({}),
        }

    mode = settings.get("mode")
    return {
        "mode": mode if mode in MODEL_SELECTION_MODES else "last_used",
        "fixed_selection": _selection_state_from_dict(settings.get("fixed_selection")),
    }


def set_model_selection_settings(sess: Session, settings: dict[str, Any]) -> None:
    mode = settings.get("mode")
    payload = {
        "mode": mode if mode in MODEL_SELECTION_MODES else "last_used",
        "fixed_selection": _selection_state_from_dict(settings.get("fixed_selection")),
    }
    set_user_setting(sess, "model_selection_settings", orjson.dumps(payload).decode())


def get_recent_models(sess: Session) -> list[str]:
    value = get_user_setting(sess, "recent_models")
    if not value:
        return []
    parsed = orjson.loads(value)
    return parsed if isinstance(parsed, list) else []


def set_recent_models(sess: Session, model_keys: list[str]) -> None:
    set_user_setting(sess, "recent_models", orjson.dumps(model_keys).decode())
