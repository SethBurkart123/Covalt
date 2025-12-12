from __future__ import annotations

from datetime import datetime
import uuid
from typing import Any, Dict

from pytauri import AppHandle

from .. import db
from ..models.chat import (
    AllChatsData,
    ChatData,
    ChatId,
    CreateChatInput,
    UpdateChatInput,
    ToggleChatToolsInput,
    UpdateChatModelInput,
    ToolInfo,
    AvailableToolsResponse,
    ChatAgentConfigResponse,
)

from ..services.agent_factory import update_agent_tools, update_agent_model
from ..services.tool_registry import get_tool_registry
from ..services.title_generator import generate_title_for_chat
from . import commands


@commands.command()
async def get_all_chats(app_handle: AppHandle) -> AllChatsData:
    chats: Dict[str, ChatData] = {}
    sess = db.session(app_handle)
    try:
        for r in db.list_chats(sess):
            chat = ChatData(
                id=r.id,
                title=r.title,
                model=r.model,
                createdAt=r.createdAt,
                updatedAt=r.updatedAt,
                messages=[],  # do not load heavy messages list here
            )
            chats[chat.id or "unknown"] = chat
    finally:
        sess.close()
    return AllChatsData(chats=chats)


@commands.command()
async def create_chat(body: CreateChatInput, app_handle: AppHandle) -> ChatData:
    now = datetime.utcnow().isoformat()
    chatId = body.id or str(uuid.uuid4())
    title = (body.title or "New Chat").strip() or "New Chat"
    
    # Handle agent config
    agent_config = None
    if body.agentConfig:
        agent_config = {
            "provider": body.agentConfig.provider,
            "model_id": body.agentConfig.modelId,
            "tool_ids": body.agentConfig.toolIds,
            "instructions": body.agentConfig.instructions,
            "name": body.agentConfig.name,
            "description": body.agentConfig.description,
        }
    else:
        # Use default config
        agent_config = db.get_default_agent_config()
    
    sess = db.session(app_handle)
    try:
        db.create_chat(
            sess,
            id=chatId,
            title=title,
            model=body.model,
            createdAt=now,
            updatedAt=now,
        )
        # Set agent config
        db.update_chat_agent_config(sess, chatId=chatId, config=agent_config)
    finally:
        sess.close()
    return ChatData(
        id=chatId,
        title=title,
        model=body.model,
        createdAt=now,
        updatedAt=now,
        messages=[],
    )


@commands.command()
async def update_chat(body: UpdateChatInput, app_handle: AppHandle) -> ChatData:
    now = datetime.utcnow().isoformat()
    sess = db.session(app_handle)
    try:
        db.update_chat(
            sess,
            id=body.id,
            title=body.title,
            model=body.model,
            updatedAt=now,
        )

        # Rehydrate
        chatRow = sess.get(db.Chat, body.id)
        if not chatRow:
            return ChatData(id=body.id, title="New Chat", messages=[])

        return ChatData(
            id=chatRow.id,
            title=chatRow.title,
            model=chatRow.model,
            createdAt=chatRow.createdAt,
            updatedAt=chatRow.updatedAt,
            messages=[],
        )
    finally:
        sess.close()


@commands.command()
async def delete_chat(body: ChatId, app_handle: AppHandle) -> None:
    sess = db.session(app_handle)
    try:
        db.delete_chat(sess, chatId=body.id)
    finally:
        sess.close()
    return None


@commands.command()
async def get_chat(body: ChatId, app_handle: AppHandle) -> Dict[str, Any]:
    sess = db.session(app_handle)
    try:
        msgs = db.get_chat_messages(sess, chatId=body.id)
    finally:
        sess.close()
    return {"id": body.id, "messages": msgs}


@commands.command()
async def toggle_chat_tools(body: ToggleChatToolsInput, app_handle: AppHandle) -> None:
    """
    Update active tools for a chat session.
    
    Args:
        body: Contains chatId and list of tool IDs to activate
        app_handle: Tauri app handle
    """
    update_agent_tools(body.chatId, body.toolIds, app_handle)
    return None


@commands.command()
async def update_chat_model(body: UpdateChatModelInput, app_handle: AppHandle) -> None:
    """
    Switch the model/provider for a chat session.
    
    Args:
        body: Contains chatId, provider, and modelId
        app_handle: Tauri app handle
    """
    update_agent_model(body.chatId, body.provider, body.modelId, app_handle)
    return None


@commands.command()
async def get_available_tools(app_handle: AppHandle) -> AvailableToolsResponse:
    """
    Get list of all available tools.
    
    Returns:
        List of tool information (id, name, description, category)
    """
    tool_registry = get_tool_registry()
    tools_data = tool_registry.list_available_tools()
    
    tools = [
        ToolInfo(
            id=tool["id"],
            name=tool.get("name"),
            description=tool.get("description"),
            category=tool.get("category"),
        )
        for tool in tools_data
    ]
    
    return AvailableToolsResponse(tools=tools)


@commands.command()
async def get_chat_agent_config(body: ChatId, app_handle: AppHandle) -> ChatAgentConfigResponse:
    """
    Get agent configuration for a chat (tools, provider, model).
    
    Args:
        body: Contains chatId
        app_handle: Tauri app handle
        
    Returns:
        Chat's agent configuration
    """
    sess = db.session(app_handle)
    try:
        config = db.get_chat_agent_config(sess, body.id)
        if not config:
            # No config yet, return defaults
            config = db.get_default_agent_config()
    finally:
        sess.close()
    
    return ChatAgentConfigResponse(
        toolIds=config.get("tool_ids", []),
        provider=config.get("provider", "openai"),
        modelId=config.get("model_id", "gpt-4o-mini"),
    )


@commands.command()
async def generate_chat_title(body: ChatId, app_handle: AppHandle) -> Dict[str, Any]:
    """
    Generate and update title for a chat based on its first message.
    
    Args:
        body: Contains chatId
        app_handle: Tauri app handle
        
    Returns:
        Dict with the new title or None if generation failed
    """
    title = generate_title_for_chat(body.id, app_handle)
    if title:
        with db.db_session(app_handle) as sess:
            db.update_chat(sess, id=body.id, title=title)
        return {"title": title}
    return {"title": None}

