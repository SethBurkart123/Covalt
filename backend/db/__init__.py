from __future__ import annotations

# Core database functionality
from .core import (
    init_database,
    session,
    db_session,
    get_db_path,
    get_resource_dir,
    set_db_path,
)

# Models
from .models import (
    Base,
    Chat,
    Message,
    ProviderSettings,
    UserSettings,
    Model,
)

# Chat operations
from .chats import (
    list_chats,
    get_chat_messages,
    create_chat,
    update_chat,
    delete_chat,
    append_message,
    update_message_content,
    get_message_path,
    get_message_children,
    get_next_sibling_sequence,
    set_active_leaf,
    create_branch_message,
    mark_message_complete,
    get_leaf_descendant,
    get_chat_agent_config,
    update_chat_agent_config,
    get_default_agent_config,
)

# Provider operations
from .providers import (
    get_provider_settings,
    get_all_provider_settings,
    save_provider_settings,
)

# Model operations
from .model_ops import (
    get_model_settings,
    get_all_model_settings,
    save_model_settings,
    upsert_model_settings,
    get_reasoning_from_model,
)

# User settings operations
from .settings import (
    get_user_setting,
    set_user_setting,
    get_default_tool_ids,
    set_default_tool_ids,
    get_general_settings,
    update_general_settings,
    get_default_general_settings,
    get_auto_title_settings,
    save_auto_title_settings,
)

__all__ = [
    # Core
    "init_database",
    "session",
    "db_session",
    "get_db_path",
    "get_resource_dir",
    "set_db_path",
    # Models
    "Base",
    "Chat",
    "Message",
    "ProviderSettings",
    "UserSettings",
    "Model",
    # Chats
    "list_chats",
    "get_chat_messages",
    "create_chat",
    "update_chat",
    "delete_chat",
    "append_message",
    "update_message_content",
    "get_message_path",
    "get_message_children",
    "get_next_sibling_sequence",
    "set_active_leaf",
    "create_branch_message",
    "mark_message_complete",
    "get_leaf_descendant",
    "get_chat_agent_config",
    "update_chat_agent_config",
    "get_default_agent_config",
    # Providers
    "get_provider_settings",
    "get_all_provider_settings",
    "save_provider_settings",
    # Model Operations
    "get_model_settings",
    "get_all_model_settings",
    "save_model_settings",
    "upsert_model_settings",
    "get_reasoning_from_model",
    # Settings
    "get_user_setting",
    "set_user_setting",
    "get_default_tool_ids",
    "set_default_tool_ids",
    "get_general_settings",
    "update_general_settings",
    "get_default_general_settings",
    "get_auto_title_settings",
    "save_auto_title_settings",
]

