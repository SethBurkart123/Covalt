from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from .models import UserSettings


def get_user_setting(sess: Session, key: str) -> Optional[str]:
    """
    Get a user setting value.
    
    Args:
        sess: Database session
        key: Setting key
        
    Returns:
        Setting value or None if not found
    """
    setting: Optional[UserSettings] = sess.get(UserSettings, key)
    return setting.value if setting else None


def set_user_setting(sess: Session, key: str, value: str) -> None:
    """
    Set a user setting value.
    
    Args:
        sess: Database session
        key: Setting key
        value: Setting value (will be stored as string)
    """
    setting: Optional[UserSettings] = sess.get(UserSettings, key)
    
    if setting:
        setting.value = value
    else:
        setting = UserSettings(key=key, value=value)
        sess.add(setting)
    
    sess.commit()


def get_default_tool_ids(sess: Session) -> List[str]:
    """
    Get default tool IDs for new chats.
    
    Args:
        sess: Database session
        
    Returns:
        List of tool IDs
    """
    value = get_user_setting(sess, "default_tool_ids")
    if not value:
        return []
    
    try:
        tool_ids = json.loads(value)
        return tool_ids if isinstance(tool_ids, list) else []
    except Exception:
        return []


def set_default_tool_ids(sess: Session, tool_ids: List[str]) -> None:
    """
    Set default tool IDs for new chats.
    
    Args:
        sess: Database session
        tool_ids: List of tool IDs
    """
    value = json.dumps(tool_ids)
    set_user_setting(sess, "default_tool_ids", value)


def get_general_settings(sess: Session) -> Dict[str, Any]:
    """
    Get all general settings as a nested dict.
    
    Args:
        sess: Database session
        
    Returns:
        Dict with all general settings, including auto_title and future settings
    """
    value = get_user_setting(sess, "general_settings")
    if not value:
        return get_default_general_settings()
    
    try:
        settings = json.loads(value)
        # Merge with defaults to ensure all keys exist
        defaults = get_default_general_settings()
        for key, default_val in defaults.items():
            if key not in settings:
                settings[key] = default_val
        return settings
    except Exception:
        return get_default_general_settings()


def update_general_settings(sess: Session, partial_settings: Dict[str, Any]) -> None:
    """
    Update general settings by merging with existing settings.
    
    Args:
        sess: Database session
        partial_settings: Dict with settings to update (partial or full)
    """
    current = get_general_settings(sess)
    current.update(partial_settings)
    set_user_setting(sess, "general_settings", json.dumps(current))


def get_default_general_settings() -> Dict[str, Any]:
    """
    Get default general settings structure.
    
    Returns:
        Default general settings with auto_title and future settings
    """
    return {
        "auto_title": {
            "enabled": True,
            "prompt": "Generate a brief, descriptive title (max 6 words) for this conversation based on the user's message: {{ message }}\n\nReturn only the title, nothing else.",
            "model_mode": "current",  # "current" or "specific"
            "provider": "openai",
            "model_id": "gpt-4o-mini",
        }
    }


def get_auto_title_settings(sess: Session) -> Dict[str, Any]:
    """
    Get auto-title settings.
    
    Args:
        sess: Database session
        
    Returns:
        Auto-title settings dict
    """
    general = get_general_settings(sess)
    return general.get("auto_title", get_default_general_settings()["auto_title"])


def save_auto_title_settings(sess: Session, settings: Dict[str, Any]) -> None:
    """
    Save auto-title settings (updates just the auto_title key in general_settings).
    
    Args:
        sess: Database session
        settings: Auto-title settings dict
    """
    update_general_settings(sess, {"auto_title": settings})


