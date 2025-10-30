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
from agno.agent import RunEvent, Message

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


def save_user_msg(app_handle: AppHandle, msg: ChatMessage, chat_id: str, parent_id: Optional[str] = None):
    """Save user message to db."""
    with db.db_session(app_handle) as sess:
        # Get sequence number for siblings
        sequence = db.get_next_sibling_sequence(sess, parent_id)
        
        # Create the message
        message = db.Message(
            id=msg.id,
            chatId=chat_id,
            role=msg.role,
            content=msg.content,
            createdAt=msg.createdAt or datetime.utcnow().isoformat(),
            parent_message_id=parent_id,
            is_complete=True,  # User messages are always complete
            sequence=sequence,
        )
        sess.add(message)
        sess.commit()
        
        # Update active leaf to this message
        db.set_active_leaf(sess, chat_id, msg.id)


def init_assistant_msg(app_handle: AppHandle, chat_id: str, parent_id: str) -> str:
    """Create empty assistant message, return id."""
    msg_id = str(uuid.uuid4())
    with db.db_session(app_handle) as sess:
        sequence = db.get_next_sibling_sequence(sess, parent_id)
        
        message = db.Message(
            id=msg_id,
            chatId=chat_id,
            role="assistant",
            content="",
            createdAt=datetime.utcnow().isoformat(),
            parent_message_id=parent_id,
            is_complete=False,
            sequence=sequence,
        )
        sess.add(message)
        sess.commit()
        
        # Update active leaf to this message
        db.set_active_leaf(sess, chat_id, msg_id)
    return msg_id


def save_msg_content(app_handle: AppHandle, msg_id: str, content: str):
    """Update message content."""
    with db.db_session(app_handle) as sess:
        db.update_message_content(sess, messageId=msg_id, content=content)


def convert_to_agno_messages(chat_msg: ChatMessage) -> List[Message]:
    """
    Convert our ChatMessage format to Agno Message format.
    Handles structured content blocks with tool calls.
    """
    if chat_msg.role == "user":
        content = chat_msg.content
        if isinstance(content, list):
            content = json.dumps(content)
        return [Message(role="user", content=content)]
    
    if chat_msg.role == "assistant":
        content = chat_msg.content
        
        if isinstance(content, str):
            return [Message(role="assistant", content=content)]
        
        if not isinstance(content, list):
            return [Message(role="assistant", content=str(content))]
        
        messages = []
        text_parts = []
        
        for block in content:
            if block.type == "text":
                text_parts.append(block.content or "")
            
            elif block.type == "tool_call":
                if text_parts:
                    messages.append(Message(
                        role="assistant",
                        content=" ".join(text_parts),
                        tool_calls=[{
                            "id": block.id,
                            "type": "function",
                            "function": {
                                "name": block.toolName,
                                "arguments": json.dumps(block.toolArgs or {})
                            }
                        }]
                    ))
                    text_parts = []
                else:
                    messages.append(Message(
                        role="assistant",
                        content=None,
                        tool_calls=[{
                            "id": block.id,
                            "type": "function",
                            "function": {
                                "name": block.toolName,
                                "arguments": json.dumps(block.toolArgs or {})
                            }
                        }]
                    ))
                
                if block.toolResult:
                    messages.append(Message(
                        role="tool",
                        tool_call_id=block.id,
                        content=str(block.toolResult)
                    ))
        
        if text_parts:
            messages.append(Message(role="assistant", content=" ".join(text_parts)))
        
        return messages if messages else [Message(role="assistant", content="")]
    
    return []


async def handle_content_stream(
    app_handle: AppHandle,
    agent,
    messages: List[ChatMessage],
    assistant_msg_id: str,
    ch: Channel[ChatEvent],
):
    """Process agent stream and emit events."""
    agno_messages = []
    for msg in messages:
        agno_messages.extend(convert_to_agno_messages(msg))
    
    response_stream = agent.arun(input=agno_messages, stream=True, stream_intermediate_steps=True)
    
    content_blocks = []
    current_text = ""
    tool_counter = 0
    full_content = ""
    had_error = False
    
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
            await asyncio.to_thread(save_msg_content, app_handle, assistant_msg_id, json.dumps(content_blocks))
            with db.db_session(app_handle) as sess:
                db.mark_message_complete(sess, assistant_msg_id)
            ch.send_model(ChatEvent(event="RunCompleted"))
        
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
            had_error = True
            return
    
    if not had_error:
        with db.db_session(app_handle) as sess:
            message = sess.get(db.Message, assistant_msg_id)
            if message and not message.is_complete:
                db.mark_message_complete(sess, assistant_msg_id)


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
    
    # Get the current active leaf to use as parent
    with db.db_session(app_handle) as sess:
        chat = sess.get(db.Chat, chat_id)
        parent_id = chat.active_leaf_message_id if chat else None
    
    if messages and messages[-1].role == "user":
        save_user_msg(app_handle, messages[-1], chat_id, parent_id)
        # Update parent_id to the newly saved user message
        parent_id = messages[-1].id
    
    ch.send_model(ChatEvent(event="RunStarted", sessionId=chat_id))
    
    assistant_msg_id = init_assistant_msg(app_handle, chat_id, parent_id)
    
    try:
        agent = create_agent_for_chat(chat_id, app_handle)
        
        if not messages or messages[-1].role != "user":
            raise ValueError("No user message found in request")
        
        await handle_content_stream(
            app_handle,
            agent,
            messages,
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
        # Note: message stays is_complete=False so user can retry/continue
