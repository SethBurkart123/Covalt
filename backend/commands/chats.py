from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Dict

from zynk import command

from .. import db
from ..models.chat import (
    AllChatsData,
    AvailableToolsResponse,
    ChatAgentConfigResponse,
    ChatData,
    ChatId,
    CreateChatInput,
    MCPToolsetInfo,
    ToggleChatToolsInput,
    ToolInfo,
    UpdateChatInput,
    UpdateChatModelInput,
)
from ..services.agent_factory import update_agent_model, update_agent_tools
from ..services.mcp_manager import ensure_mcp_initialized
from ..services.title_generator import generate_title_for_chat
from ..services.tool_registry import get_tool_registry


@command
async def get_all_chats() -> AllChatsData:
    chats: Dict[str, ChatData] = {}
    with db.db_session() as sess:
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
    return AllChatsData(chats=chats)


@command
async def create_chat(body: CreateChatInput) -> ChatData:
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

    with db.db_session() as sess:
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
    return ChatData(
        id=chatId,
        title=title,
        model=body.model,
        createdAt=now,
        updatedAt=now,
        messages=[],
    )


@command
async def update_chat(body: UpdateChatInput) -> ChatData:
    now = datetime.utcnow().isoformat()
    with db.db_session() as sess:
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


@command
async def delete_chat(body: ChatId) -> None:
    with db.db_session() as sess:
        db.delete_chat(sess, chatId=body.id)
    return None


@command
async def get_chat(body: ChatId) -> Dict[str, Any]:
    with db.db_session() as sess:
        msgs = db.get_chat_messages(sess, chatId=body.id)
    return {"id": body.id, "messages": msgs}


@command
async def toggle_chat_tools(body: ToggleChatToolsInput) -> None:
    """
    Update active tools for a chat session.

    Args:
        body: Contains chatId and list of tool IDs to activate
    """
    update_agent_tools(body.chatId, body.toolIds)
    return None


@command
async def update_chat_model(body: UpdateChatModelInput) -> None:
    """
    Switch the model/provider for a chat session.

    Args:
        body: Contains chatId, provider, and modelId
    """
    update_agent_model(body.chatId, body.provider, body.modelId)
    return None


@command
async def get_available_tools() -> AvailableToolsResponse:
    """
    Get all available tools (builtin and MCP).

    Returns:
        Response with:
        - tools: Flat list of all tools
    """
    tool_registry = get_tool_registry()
    mcp = await ensure_mcp_initialized()

    builtin_data = tool_registry.list_builtin_tools()
    builtin_tools = [
        ToolInfo(
            id=tool["id"],
            name=tool.get("name"),
            description=tool.get("description"),
            category=tool.get("category"),
            renderer=tool.get("renderer"),
            editable_args=tool.get("editable_args"),
            requires_confirmation=tool.get("requires_confirmation"),
        )
        for tool in builtin_data
    ]

    mcp_toolsets = []
    all_mcp_tools: list[ToolInfo] = []

    for server in mcp.get_servers():
        server_id = server["id"]
        tools = [
            ToolInfo(
                id=t["id"],
                name=t["name"],
                description=t.get("description"),
                category=f"{server_id}",
                inputSchema=t.get("inputSchema"),
                renderer=t.get("renderer"),
                editable_args=t.get("editable_args"),
                requires_confirmation=t.get("requires_confirmation", True),
            )
            for t in mcp.get_server_tools(server_id)
        ]

        mcp_toolsets.append(
            MCPToolsetInfo(
                id=f"mcp:{server_id}",
                name=server_id,
                status=server["status"],
                error=server.get("error"),
                tools=tools,
            )
        )

        if server["status"] == "connected":
            all_mcp_tools.extend(tools)

    all_tools = builtin_tools + all_mcp_tools

    return AvailableToolsResponse(
        tools=all_tools
    )


@command
async def get_chat_agent_config(body: ChatId) -> ChatAgentConfigResponse:
    """
    Get agent configuration for a chat (tools, provider, model).

    Args:
        body: Contains chatId

    Returns:
        Chat's agent configuration
    """
    with db.db_session() as sess:
        config = db.get_chat_agent_config(sess, body.id)
        if not config:
            # No config yet, return defaults
            config = db.get_default_agent_config()

    return ChatAgentConfigResponse(
        toolIds=config.get("tool_ids", []),
        provider=config.get("provider", "openai"),
        modelId=config.get("model_id", "gpt-4o-mini"),
    )


@command
async def generate_chat_title(body: ChatId) -> Dict[str, Any]:
    """
    Generate and update title for a chat based on its first message.

    Args:
        body: Contains chatId

    Returns:
        Dict with the new title or None if generation failed
    """
    title = generate_title_for_chat(body.id)
    if title:
        with db.db_session() as sess:
            db.update_chat(sess, id=body.id, title=title)
        return {"title": title}
    return {"title": None}
