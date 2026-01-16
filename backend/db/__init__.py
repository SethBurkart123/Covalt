from __future__ import annotations

# Chat operations
from .chats import (
    append_message,
    create_branch_message,
    create_chat,
    delete_chat,
    get_chat_agent_config,
    get_chat_messages,
    get_default_agent_config,
    get_leaf_descendant,
    get_manifest_for_message,
    get_message_children,
    get_message_path,
    get_next_sibling_sequence,
    list_chats,
    mark_message_complete,
    set_active_leaf,
    set_message_manifest,
    update_chat,
    update_chat_agent_config,
    update_message_content,
)

# Core database functionality
from .core import (
    db_session,
    get_db_path,
    init_database,
    session,
    set_db_path,
)

# Model operations
from .model_ops import (
    get_all_model_settings,
    get_model_settings,
    get_reasoning_from_model,
    save_model_settings,
    upsert_model_settings,
)

# Models
from .models import (
    Base,
    Chat,
    McpServer,
    Message,
    Model,
    ProviderSettings,
    UserSettings,
)

# Provider operations
from .providers import (
    get_all_provider_settings,
    get_provider_settings,
    save_provider_settings,
)

# User settings operations
from .settings import (
    get_auto_title_settings,
    get_default_general_settings,
    get_default_tool_ids,
    get_general_settings,
    get_user_setting,
    save_auto_title_settings,
    set_default_tool_ids,
    set_user_setting,
    update_general_settings,
)

__all__ = [
    # Core
    "init_database",
    "session",
    "db_session",
    "get_db_path",
    "set_db_path",
    # Models
    "Base",
    "Chat",
    "McpServer",
    "Message",
    "Model",
    "ProviderSettings",
    "UserSettings",
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
    "get_manifest_for_message",
    "set_message_manifest",
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
