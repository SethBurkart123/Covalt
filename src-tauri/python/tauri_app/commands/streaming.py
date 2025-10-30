from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime
from typing import List, Optional, Dict, Any
import traceback

from pydantic import BaseModel
from pytauri import AppHandle
from pytauri.ipc import Channel, JavaScriptChannelId
from pytauri.webview import WebviewWindow
from agno.agent import RunEvent

from .. import db
from ..models.chat import ChatEvent, ChatMessage
from ..services.agent_factory import create_agent_for_chat
from . import commands

from rich import print


def parse_model_id(model_id: Optional[str]) -> tuple[str, str]:
    """Parse 'provider:model' format."""
    if not model_id:
        return "", ""
    if ":" in model_id:
        provider, model = model_id.split(":", 1)
        return provider, model
    return "", model_id


def ensure_chat_initialized(app_handle: AppHandle, chat_id: Optional[str], model_id: Optional[str]) -> str:
    """Create chat and config if needed, return chat_id."""
    if not chat_id:
        chat_id = str(uuid.uuid4())
        with db.db_session(app_handle) as sess:
            now = datetime.utcnow().isoformat()
            db.create_chat(sess, id=chat_id, title="New Chat", model=model_id, createdAt=now, updatedAt=now)
            provider, model = parse_model_id(model_id)
            config = {
                "provider": provider,
                "model_id": model,
                "tool_ids": db.get_default_tool_ids(sess),
                "instructions": [],
            }
            db.update_chat_agent_config(sess, chatId=chat_id, config=config)
        return chat_id
    
    with db.db_session(app_handle) as sess:
        config = db.get_chat_agent_config(sess, chat_id)
        if not config:
            provider, model = parse_model_id(model_id)
            config = {
                "provider": provider,
                "model_id": model,
                "tool_ids": db.get_default_tool_ids(sess),
                "instructions": [],
            }
            db.update_chat_agent_config(sess, chatId=chat_id, config=config)
    
    return chat_id


def save_user_msg(app_handle: AppHandle, msg: ChatMessage, chat_id: str):
    """Save user message to db."""
    with db.db_session(app_handle) as sess:
        db.append_message(
            sess,
            id=msg.id,
            chatId=chat_id,
            role=msg.role,
            content=msg.content,
            createdAt=msg.createdAt or datetime.utcnow().isoformat(),
            toolCalls=msg.toolCalls,
        )


def init_assistant_msg(app_handle: AppHandle, chat_id: str) -> str:
    """Create empty assistant message, return id."""
    msg_id = str(uuid.uuid4())
    with db.db_session(app_handle) as sess:
        db.append_message(
            sess,
            id=msg_id,
            chatId=chat_id,
            role="assistant",
            content="",
            createdAt=datetime.utcnow().isoformat(),
        )
    return msg_id


def save_msg_content(app_handle: AppHandle, msg_id: str, content: str):
    """Update message content."""
    with db.db_session(app_handle) as sess:
        db.update_message_content(sess, messageId=msg_id, content=content)


async def handle_content_stream(
    app_handle: AppHandle,
    agent,
    user_msg: str,
    assistant_msg_id: str,
    ch: Channel[ChatEvent],
):
    """Process agent stream and emit events."""
    response_stream = agent.arun(user_msg, stream=True, stream_intermediate_steps=True)
    
    content_blocks = []
    current_text = ""
    tool_counter = 0
    full_content = ""
    
    def flush_text():
        nonlocal current_text
        if current_text:
            content_blocks.append({"type": "text", "content": current_text})
            current_text = ""
    
    async for chunk in response_stream:
        if chunk.event == RunEvent.run_content:
            if chunk.content:
                full_content += chunk.content
                current_text += chunk.content
                ch.send_model(ChatEvent(event="RunContent", content=chunk.content))
                await asyncio.to_thread(save_msg_content, app_handle, assistant_msg_id, full_content)
        
        elif chunk.event == RunEvent.tool_call_started:
            tool_id = f"{assistant_msg_id}-tool-{tool_counter}"
            ch.send_model(ChatEvent(
                event="ToolCallStarted",
                tool={
                    "id": tool_id,
                    "toolName": chunk.tool.tool_name,
                    "toolArgs": chunk.tool.tool_args,
                    "isCompleted": False,
                }
            ))
        
        elif chunk.event == RunEvent.tool_call_completed:
            flush_text()
            tool_id = f"{assistant_msg_id}-tool-{tool_counter}"
            tool_counter += 1
            
            tool_block = {
                "type": "tool_call",
                "id": tool_id,
                "toolName": chunk.tool.tool_name,
                "toolArgs": chunk.tool.tool_args,
                "toolResult": str(chunk.tool.result) if chunk.tool.result is not None else None,
                "isCompleted": True,
            }
            content_blocks.append(tool_block)
            ch.send_model(ChatEvent(event="ToolCallCompleted", tool=tool_block))
        
        elif chunk.event == RunEvent.run_completed:
            flush_text()
            ch.send_model(ChatEvent(event="RunCompleted"))
            await asyncio.to_thread(save_msg_content, app_handle, assistant_msg_id, json.dumps(content_blocks))
        
        elif chunk.event == RunEvent.run_error:
            print(f"[stream] RunError: {chunk.error.message}")
            flush_text()
            
            error_block = {
                "type": "error",
                "content": str(chunk.error.message) if hasattr(chunk.error, 'message') else str(chunk),
                "timestamp": datetime.utcnow().isoformat()
            }
            content_blocks.append(error_block)
            ch.send_model(ChatEvent(event="RunError", content=str(chunk)))
            await asyncio.to_thread(save_msg_content, app_handle, assistant_msg_id, json.dumps(content_blocks))


class StreamChatRequest(BaseModel):
    channel: JavaScriptChannelId[ChatEvent]
    messages: List[Dict[str, Any]]
    modelId: Optional[str] = None
    chatId: Optional[str] = None


@commands.command()
async def stream_chat(
    body: StreamChatRequest,
    webview_window: WebviewWindow,
    app_handle: AppHandle,
) -> None:
    ch: Channel[ChatEvent] = body.channel.channel_on(webview_window.as_ref_webview())
    messages: List[ChatMessage] = [
        ChatMessage(
            id=m.get("id"),
            role=m.get("role"),
            content=m.get("content", ""),
            createdAt=m.get("createdAt"),
            toolCalls=m.get("toolCalls"),
        )
        for m in body.messages
    ]
    
    chat_id = ensure_chat_initialized(app_handle, body.chatId, body.modelId)
    
    if messages and messages[-1].role == "user":
        save_user_msg(app_handle, messages[-1], chat_id)
    
    ch.send_model(ChatEvent(event="RunStarted", sessionId=chat_id))
    
    assistant_msg_id = init_assistant_msg(app_handle, chat_id)
    
    try:
        agent = create_agent_for_chat(chat_id, app_handle)
        
        if not messages or messages[-1].role != "user":
            raise ValueError("No user message found in request")
        
        await handle_content_stream(
            app_handle,
            agent,
            messages[-1].content,
            assistant_msg_id,
            ch,
        )
        
    except Exception as e:
        print(f"[stream] Error: {e}")
        print(traceback.format_exc())
        
        error_block = {
            "type": "error",
            "content": str(e),
            "traceback": traceback.format_exc(),
            "timestamp": datetime.utcnow().isoformat()
        }
        
        save_msg_content(app_handle, assistant_msg_id, json.dumps([error_block]))
        ch.send_model(ChatEvent(event="RunError", content=str(e)))
