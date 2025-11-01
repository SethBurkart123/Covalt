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

# Global storage for active run IDs by message ID
_active_runs: Dict[str, tuple] = {}  # message_id -> (run_id, agent)


def parse_model_id(model_id: Optional[str]) -> tuple[str, str]:
    """Parse 'provider:model' format."""
    if not model_id:
        return "", ""
    if ":" in model_id:
        provider, model = model_id.split(":", 1)
        return provider, model
    return "", model_id


def ensure_chat_initialized(app_handle: AppHandle, chat_id: Optional[str], model_id: Optional[str]) -> str:
    """
    Create chat and config if needed, and ensure model/provider are up to date.

    Returns the chat_id.
    """
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

    # Existing chat: ensure agent config exists and, if a model_id was provided,
    # update the provider/model to match the current selection.
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
        elif model_id:
            # Only update provider/model; preserve tools/instructions and other fields
            provider, model = parse_model_id(model_id)
            # Update if different from current config
            cur_provider = config.get("provider") or ""
            cur_model = config.get("model_id") or ""
            if (provider and provider != cur_provider) or (model and model != cur_model):
                if provider:
                    config["provider"] = provider
                if model:
                    config["model_id"] = model
                db.update_chat_agent_config(sess, chatId=chat_id, config=config)

    return chat_id


def save_user_msg(app_handle: AppHandle, msg: ChatMessage, chat_id: str, parent_id: Optional[str] = None):
    """Save user message to db."""
    with db.db_session(app_handle) as sess:
        # Get sequence number for siblings
        sequence = db.get_next_sibling_sequence(sess, parent_id, chat_id)
        
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
        sequence = db.get_next_sibling_sequence(sess, parent_id, chat_id)
        # Determine model used from chat's agent config
        model_used: Optional[str] = None
        try:
            config = db.get_chat_agent_config(sess, chat_id)
            if config:
                provider = config.get("provider") or ""
                model_id = config.get("model_id") or ""
                if provider and model_id:
                    model_used = f"{provider}:{model_id}"
                else:
                    model_used = model_id or None
        except Exception:
            model_used = None
        
        message = db.Message(
            id=msg_id,
            chatId=chat_id,
            role="assistant",
            content="",
            createdAt=datetime.utcnow().isoformat(),
            parent_message_id=parent_id,
            is_complete=False,
            sequence=sequence,
            model_used=model_used,
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

    # Initialize content blocks with any existing message content so we append
    content_blocks: List[Dict[str, Any]] = []
    current_text = ""
    tool_counter = 0

    # Load existing assistant message content (for continue) and trim trailing error
    try:
        with db.db_session(app_handle) as sess:
            message = sess.get(db.Message, assistant_msg_id)
            if message and message.content:
                raw = message.content.strip()
                initial_blocks: List[Dict[str, Any]] = []
                if raw.startswith('['):
                    try:
                        initial_blocks = json.loads(raw)
                    except Exception:
                        # If parsing fails, treat as legacy text
                        initial_blocks = [{"type": "text", "content": message.content}]
                else:
                    # Legacy/plain text
                    initial_blocks = [{"type": "text", "content": message.content}]

                # Remove trailing error blocks so continuation starts from valid content
                while initial_blocks and isinstance(initial_blocks[-1], dict) and initial_blocks[-1].get("type") == "error":
                    initial_blocks.pop()

                content_blocks.extend(initial_blocks)
                # Initialize tool counter to number of existing tool_call blocks
                tool_counter = sum(1 for b in content_blocks if isinstance(b, dict) and b.get("type") == "tool_call")
    except Exception as e:
        print(f"[stream] Warning loading initial content for {assistant_msg_id}: {e}")
    had_error = False
    run_id = None
    
    def flush_text():
        nonlocal current_text
        if current_text:
            content_blocks.append({"type": "text", "content": current_text})
            current_text = ""
    
    def save_current_state():
        """Save current content blocks state to database."""
        # Build temporary blocks including any unflushed text
        temp_blocks = content_blocks.copy()
        if current_text:
            temp_blocks.append({"type": "text", "content": current_text})
        return json.dumps(temp_blocks)
    
    async for chunk in response_stream:
        # Capture run_id from first event
        if not run_id and hasattr(chunk, 'run_id') and chunk.run_id:
            run_id = chunk.run_id
            _active_runs[assistant_msg_id] = (run_id, agent)
            print(f"[stream] Captured run_id {run_id} for message {assistant_msg_id}")
        
        if chunk.event == RunEvent.run_cancelled:
            print(f"[stream] Run cancelled: {chunk.run_id}")
            flush_text()
            await asyncio.to_thread(save_msg_content, app_handle, assistant_msg_id, save_current_state())
            
            # Mark as complete and clean up
            with db.db_session(app_handle) as sess:
                db.mark_message_complete(sess, assistant_msg_id)
            
            if assistant_msg_id in _active_runs:
                del _active_runs[assistant_msg_id]
            
            ch.send_model(ChatEvent(event="RunCancelled"))
            return
        
        if chunk.event == RunEvent.run_content:
            if chunk.content:
                current_text += chunk.content
                ch.send_model(ChatEvent(event="RunContent", content=chunk.content))
                await asyncio.to_thread(save_msg_content, app_handle, assistant_msg_id, save_current_state())
        
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
            await asyncio.to_thread(save_msg_content, app_handle, assistant_msg_id, json.dumps(content_blocks))
            ch.send_model(ChatEvent(event="RunError", content=str(chunk)))
            had_error = True
            return
    
    # Clean up run tracking
    if assistant_msg_id in _active_runs:
        del _active_runs[assistant_msg_id]
    
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


class CancelRunRequest(BaseModel):
    messageId: str


@commands.command()
async def cancel_run(body: CancelRunRequest, app_handle: AppHandle) -> dict:
    """Cancel an active streaming run. Returns {cancelled: bool}"""
    message_id = body.messageId
    
    if message_id not in _active_runs:
        print(f"[cancel_run] No active run found for message {message_id}")
        return {"cancelled": False}
    
    run_id, agent = _active_runs[message_id]
    
    try:
        print(f"[cancel_run] Cancelling run {run_id} for message {message_id}")
        agent.cancel_run(run_id)
        
        # Mark message as complete in database
        with db.db_session(app_handle) as sess:
            db.mark_message_complete(sess, message_id)
        
        # Clean up tracking
        del _active_runs[message_id]
        
        print(f"[cancel_run] Successfully cancelled run {run_id}")
        return {"cancelled": True}
    except Exception as e:
        print(f"[cancel_run] Error cancelling run: {e}")
        return {"cancelled": False}


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
    
    # Emit the assistant message ID for frontend tracking
    ch.send_model(ChatEvent(event="AssistantMessageId", content=assistant_msg_id))
    
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

        # Preserve any existing content and append the error block
        try:
            with db.db_session(app_handle) as sess:
                message = sess.get(db.Message, assistant_msg_id)
                blocks: List[Dict[str, Any]] = []
                if message and message.content:
                    raw = message.content.strip()
                    if raw.startswith('['):
                        try:
                            blocks = json.loads(raw)
                        except Exception:
                            blocks = [{"type": "text", "content": message.content}]
                    else:
                        blocks = [{"type": "text", "content": message.content}]
                blocks.append(error_block)
                db.update_message_content(sess, messageId=assistant_msg_id, content=json.dumps(blocks))
        except Exception as e2:
            print(f"[stream] Failed to append error block, falling back: {e2}")
            save_msg_content(app_handle, assistant_msg_id, json.dumps([error_block]))
        ch.send_model(ChatEvent(event="RunError", content=str(e)))
        # Note: message stays is_complete=False so user can retry/continue
