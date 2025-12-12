"""
Agent Factory for creating Agno agent instances.

Creates fresh agent instances per request as recommended by Agno docs.
Manages agent configuration, model selection, and tool activation.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from .. import db
from .model_factory import get_model
from .tool_registry import get_tool_registry
from .hook_manager import get_hook_manager

from agno.agent import Agent

def create_agent_for_chat(
    chat_id: str,
    history_messages: Optional[List[Dict[str, Any]]] = None,
    channel=None,
    assistant_msg_id: str = None,
) -> Any:
    """
    Create a fresh Agno agent instance for a chat session.
    
    Per Agno best practices, creates a new agent instance for each request
    to avoid state contamination. Loads configuration from database.
    
    Args:
        chat_id: Chat identifier
        history_messages: Optional list of previous messages to include as context
        channel: Optional channel for sending events (needed for approval gates)
        assistant_msg_id: Optional assistant message ID (needed for approval gates)
        
    Returns:
        Configured Agno Agent instance
        
    Raises:
        RuntimeError: If agent configuration is invalid or missing required keys
    """
    
    # Load agent configuration from database
    with db.db_session() as sess:
        config = db.get_chat_agent_config(sess, chat_id)
        if not config:
            # Use default config if not set
            config = db.get_default_agent_config()
            db.update_chat_agent_config(sess, chatId=chat_id, config=config)
    
    # Extract configuration
    provider = config.get("provider", "openai")
    model_id = config.get("model_id")
    tool_ids = config.get("tool_ids", [])
    instructions = config.get("instructions", [])
    name = config.get("name", "Assistant")
    description = config.get("description", "You are a helpful AI assistant.")
    
    # Get model instance
    model = get_model(provider, model_id)
    
    # Get tool instances
    tool_registry = get_tool_registry()
    tools = tool_registry.get_tools(tool_ids) if tool_ids else []
    
    # Set up hook manager with tool metadata
    hook_manager = get_hook_manager()
    for tool_id in tool_ids:
        metadata = tool_registry._metadata.get(tool_id, {})
        hook_manager.register_tool_metadata(
            tool_id=tool_id,
            requires_approval=metadata.get("requires_approval", False),
            allow_edit=metadata.get("allow_edit", False),
            renderer=metadata.get("renderer"),
        )
    
    # Create pre-hook (handles all logic including approval and renderer metadata)
    pre_hook = hook_manager.create_pre_hook(
        channel=channel,
        assistant_msg_id=assistant_msg_id,
    )
    
    # Create agent instance with hooks
    # NOTE: We do NOT use Agno's database or history management
    # All persistence is handled through our SQLAlchemy DB
    agent = Agent(
        name=name,
        model=model,
        tools=tools if tools else None,
        description=description,
        instructions=instructions if instructions else None,
        markdown=True,  # Enable markdown formatting
        stream_intermediate_steps=True,
        tool_hooks=[pre_hook],  # Single hook that does everything!
        #debug_mode=True  # Temporary for debugging tool calls
    )
    
    return agent


def update_agent_tools(
    chat_id: str,
    tool_ids: List[str],
) -> None:
    """
    Update active tools for a chat session.
    
    Updates the chat's agent configuration in the database.
    Next agent creation will use these tools.
    
    Args:
        chat_id: Chat identifier
        tool_ids: List of tool IDs to activate
    """
    with db.db_session() as sess:
        config = db.get_chat_agent_config(sess, chat_id)
        if not config:
            config = db.get_default_agent_config()
        
        config["tool_ids"] = tool_ids
        db.update_chat_agent_config(sess, chatId=chat_id, config=config)


def update_agent_model(
    chat_id: str,
    provider: str,
    model_id: str,
) -> None:
    """
    Update model for a chat session.
    
    Updates the chat's agent configuration in the database.
    Next agent creation will use this model.
    
    Args:
        chat_id: Chat identifier
        provider: Model provider (openai, anthropic, groq, ollama)
        model_id: Model identifier
    """
    with db.db_session() as sess:
        config = db.get_chat_agent_config(sess, chat_id)
        if not config:
            config = db.get_default_agent_config()
        
        config["provider"] = provider
        config["model_id"] = model_id
        db.update_chat_agent_config(sess, chatId=chat_id, config=config)

