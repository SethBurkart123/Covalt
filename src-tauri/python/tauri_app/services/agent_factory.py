"""
Agent Factory for creating Agno agent instances.

Creates fresh agent instances per request as recommended by Agno docs.
Manages agent configuration, model selection, and tool activation.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from pytauri import AppHandle

from .. import db
from .model_factory import get_model, get_default_model_for_provider
from .tool_registry import get_tool_registry


def create_agent_for_chat(
    chat_id: str,
    app_handle: AppHandle,
    history_messages: Optional[List[Dict[str, Any]]] = None,
) -> Any:
    """
    Create a fresh Agno agent instance for a chat session.
    
    Per Agno best practices, creates a new agent instance for each request
    to avoid state contamination. Loads configuration from database.
    
    Args:
        chat_id: Chat identifier
        app_handle: Tauri app handle for database access
        history_messages: Optional list of previous messages to include as context
        
    Returns:
        Configured Agno Agent instance
        
    Raises:
        RuntimeError: If agent configuration is invalid or missing required keys
    """
    from agno.agent import Agent
    
    # Load agent configuration from database
    sess = db.session(app_handle)
    try:
        config = db.get_chat_agent_config(sess, chat_id)
        if not config:
            # Use default config if not set
            config = db.get_default_agent_config()
            db.update_chat_agent_config(sess, chatId=chat_id, config=config)
    finally:
        sess.close()
    
    # Extract configuration
    provider = config.get("provider", "openai")
    model_id = config.get("model_id") or get_default_model_for_provider(provider)
    tool_ids = config.get("tool_ids", [])
    instructions = config.get("instructions", [])
    name = config.get("name", "Assistant")
    description = config.get("description", "You are a helpful AI assistant.")
    
    # Get model instance
    model = get_model(provider, model_id, app_handle)
    
    # Get tool instances
    tool_registry = get_tool_registry()
    tools = tool_registry.get_tools(tool_ids) if tool_ids else []
    
    # Create agent instance
    # NOTE: We do NOT use Agno's database or history management
    # We handle all persistence through our SQLAlchemy DB
    agent = Agent(
        name=name,
        model=model,
        tools=tools if tools else None,
        description=description,
        instructions=instructions if instructions else None,
        markdown=True,  # Enable markdown formatting
    )
    
    return agent


def convert_messages_to_agno_format(
    messages: List[Dict[str, Any]]
) -> List[Dict[str, str]]:
    """
    Convert database messages to Agno's expected format.
    
    Agno expects: [{"role": "user", "content": "..."}, ...]
    
    Args:
        messages: List of message dicts from database
        
    Returns:
        List of messages in Agno format
    """
    agno_messages = []
    for msg in messages:
        role = msg.get("role")
        content = msg.get("content", "")
        
        # Skip messages with no role or content
        if not role or content is None:
            continue
        
        agno_messages.append({
            "role": role,
            "content": content,
        })
    
    return agno_messages


def build_agent_context(
    history_messages: List[Dict[str, Any]],
    new_user_message: str,
) -> str:
    """
    Build context string from history messages and new message.
    
    Since we're not using Agno's history management, we need to
    construct a context-aware prompt manually when needed.
    
    Args:
        history_messages: Previous messages from database
        new_user_message: New message from user
        
    Returns:
        Context string to pass to agent
    """
    # For simple cases, we can just pass the new message
    # For complex cases with history, we'd build a context string
    # But Agno agents can handle message arrays directly
    return new_user_message


def update_agent_tools(
    chat_id: str,
    tool_ids: List[str],
    app_handle: AppHandle,
) -> None:
    """
    Update active tools for a chat session.
    
    Updates the chat's agent configuration in the database.
    Next agent creation will use these tools.
    
    Args:
        chat_id: Chat identifier
        tool_ids: List of tool IDs to activate
        app_handle: Tauri app handle for database access
    """
    sess = db.session(app_handle)
    try:
        config = db.get_chat_agent_config(sess, chat_id)
        if not config:
            config = db.get_default_agent_config()
        
        config["tool_ids"] = tool_ids
        db.update_chat_agent_config(sess, chatId=chat_id, config=config)
    finally:
        sess.close()


def update_agent_model(
    chat_id: str,
    provider: str,
    model_id: str,
    app_handle: AppHandle,
) -> None:
    """
    Update model for a chat session.
    
    Updates the chat's agent configuration in the database.
    Next agent creation will use this model.
    
    Args:
        chat_id: Chat identifier
        provider: Model provider (openai, anthropic, groq, ollama)
        model_id: Model identifier
        app_handle: Tauri app handle for database access
    """
    sess = db.session(app_handle)
    try:
        config = db.get_chat_agent_config(sess, chat_id)
        if not config:
            config = db.get_default_agent_config()
        
        config["provider"] = provider
        config["model_id"] = model_id
        db.update_chat_agent_config(sess, chatId=chat_id, config=config)
    finally:
        sess.close()

