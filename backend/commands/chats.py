from __future__ import annotations

import base64
import uuid
from datetime import datetime
from typing import Any, Dict

from pydantic import BaseModel
from zynk import command

from .. import db
from ..models.chat import (
    AllChatsData,
    AvailableToolsResponse,
    ChatAgentConfigResponse,
    ChatData,
    ChatId,
    ExecutionEventItem,
    MessageExecutionTraceResponse,
    MessageId,
    CreateChatInput,
    MCPToolsetInfo,
    ToggleChatToolsInput,
    ToolInfo,
    UpdateChatInput,
    UpdateChatModelInput,
)
from ..services.chat_config import update_chat_model_provider, update_chat_tool_ids
from ..services.workspace_manager import delete_chat_workspace, get_workspace_manager
from ..services.mcp_manager import ensure_mcp_initialized
from ..services.title_generator import generate_title_for_chat
from ..services.tool_registry import get_tool_registry


@command
async def get_all_chats() -> AllChatsData:
    with db.db_session() as sess:
        chats = {
            r.id: ChatData(
                id=r.id,
                title=r.title,
                model=r.model,
                createdAt=r.createdAt,
                updatedAt=r.updatedAt,
                starred=r.starred,
                messages=[],
            )
            for r in db.list_chats(sess)
        }
    return AllChatsData(chats=chats)


@command
async def create_chat(body: CreateChatInput) -> ChatData:
    now = datetime.utcnow().isoformat()
    chatId = body.id or str(uuid.uuid4())
    title = (body.title or "New Chat").strip() or "New Chat"

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
        db.update_chat_agent_config(sess, chatId=chatId, config=agent_config)
    return ChatData(
        id=chatId,
        title=title,
        model=body.model,
        createdAt=now,
        updatedAt=now,
        starred=False,
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

        chatRow = sess.get(db.Chat, body.id)
        if not chatRow:
            return ChatData(id=body.id, title="New Chat", messages=[])

        return ChatData(
            id=chatRow.id,
            title=chatRow.title,
            model=chatRow.model,
            createdAt=chatRow.createdAt,
            updatedAt=chatRow.updatedAt,
            starred=chatRow.starred,
            messages=[],
        )


@command
async def delete_chat(body: ChatId) -> None:
    with db.db_session() as sess:
        db.delete_chat(sess, chatId=body.id)
    delete_chat_workspace(body.id)


@command
async def toggle_star_chat(body: ChatId) -> ChatData:
    with db.db_session() as sess:
        chat = sess.get(db.Chat, body.id)
        if not chat:
            raise ValueError(f"Chat {body.id} not found")
        chat.starred = not chat.starred
        sess.commit()
        return ChatData(
            id=chat.id,
            title=chat.title,
            model=chat.model,
            createdAt=chat.createdAt,
            updatedAt=chat.updatedAt,
            starred=chat.starred,
            messages=[],
        )


@command
async def get_chat(body: ChatId) -> Dict[str, Any]:
    with db.db_session() as sess:
        msgs = db.get_chat_messages(sess, chatId=body.id)
    return {"id": body.id, "messages": msgs}


@command
async def get_message_execution_trace(body: MessageId) -> MessageExecutionTraceResponse:
    with db.db_session() as sess:
        run = db.get_latest_execution_run_for_message(sess, message_id=body.id)
        if run is None:
            return MessageExecutionTraceResponse()

        events = db.get_execution_events(sess, execution_id=run.id)

    return MessageExecutionTraceResponse(
        executionId=run.id,
        kind=run.kind,
        status=run.status,
        rootRunId=run.root_run_id,
        startedAt=run.started_at,
        endedAt=run.ended_at,
        events=[ExecutionEventItem(**event) for event in events],
    )


@command
async def toggle_chat_tools(body: ToggleChatToolsInput) -> None:
    update_chat_tool_ids(body.chatId, body.toolIds)


@command
async def update_chat_model(body: UpdateChatModelInput) -> None:
    update_chat_model_provider(body.chatId, body.provider, body.modelId)


@command
async def get_available_tools() -> AvailableToolsResponse:
    tool_registry = get_tool_registry()
    mcp = await ensure_mcp_initialized()

    builtin_data = tool_registry.list_builtin_tools()
    builtin_tools = [
        ToolInfo(
            id=tool["id"],
            name=tool.get("name"),
            description=tool.get("description"),
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

    toolset_data = tool_registry.list_toolset_tools()
    toolset_tools = [
        ToolInfo(
            id=tool["id"],
            name=tool.get("name"),
            description=tool.get("description"),
            category=tool.get("toolset_name") or tool.get("toolset_id"),
            requires_confirmation=tool.get("requires_confirmation", False),
        )
        for tool in toolset_data
    ]

    all_tools = builtin_tools + all_mcp_tools + toolset_tools

    return AvailableToolsResponse(tools=all_tools)


@command
async def get_chat_agent_config(body: ChatId) -> ChatAgentConfigResponse:
    with db.db_session() as sess:
        config = db.get_chat_agent_config(sess, body.id)
        if not config:
            config = db.get_default_agent_config()

    return ChatAgentConfigResponse(
        toolIds=config.get("tool_ids", []),
        provider=config.get("provider", "openai"),
        modelId=config.get("model_id", "gpt-4o-mini"),
    )


@command
async def generate_chat_title(body: ChatId) -> Dict[str, Any]:
    title = generate_title_for_chat(body.id)
    if title:
        with db.db_session() as sess:
            db.update_chat(sess, id=body.id, title=title)
        return {"title": title}
    return {"title": None}


class GetAttachmentInput(BaseModel):
    chatId: str
    attachmentId: str
    mimeType: str
    name: str


class AttachmentDataResponse(BaseModel):
    data: str
    mimeType: str


@command
async def get_attachment(body: GetAttachmentInput) -> AttachmentDataResponse:
    workspace_manager = get_workspace_manager(body.chatId)
    file_bytes = workspace_manager.read_file(body.name)
    if not file_bytes:
        raise FileNotFoundError(f"Attachment '{body.name}' not found in workspace")
    return AttachmentDataResponse(
        data=base64.b64encode(file_bytes).decode("utf-8"), mimeType=body.mimeType
    )
