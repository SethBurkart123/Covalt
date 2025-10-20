from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime
from typing import List, Optional, Dict, Any

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
    
    modelId = body.modelId
    chatId = body.chatId

    provider = "openai"
    actual_model_id = "gpt-4o-mini"
    if modelId and ":" in modelId:
        parts = modelId.split(":", 1)
        provider = parts[0]
        actual_model_id = parts[1]
    elif modelId:
        actual_model_id = modelId

    if not chatId:
        chatId = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()
        sess = db.session(app_handle)
        try:
            db.create_chat(
                sess,
                id=chatId,
                title="New Chat",
                model=modelId,
                createdAt=now,
                updatedAt=now,
            )
            default_tool_ids = db.get_default_tool_ids(sess)
            
            config = {
                "provider": provider,
                "model_id": actual_model_id,
                "tool_ids": default_tool_ids,
                "instructions": [],
            }
            db.update_chat_agent_config(sess, chatId=chatId, config=config)
        finally:
            sess.close()
    else:
        sess = db.session(app_handle)
        try:
            config = db.get_chat_agent_config(sess, chatId)
            if not config:
                default_tool_ids = db.get_default_tool_ids(sess)
                config = {
                    "provider": provider,
                    "model_id": actual_model_id,
                    "tool_ids": default_tool_ids,
                    "instructions": [],
                }
                db.update_chat_agent_config(sess, chatId=chatId, config=config)
        finally:
            sess.close()

    if messages and messages[-1].role == "user":
        userMessage = messages[-1]
        sess = db.session(app_handle)
        try:
            db.append_message(
                sess,
                id=userMessage.id,
                chatId=chatId,
                role=userMessage.role,
                content=userMessage.content,
                createdAt=userMessage.createdAt or datetime.utcnow().isoformat(),
                toolCalls=userMessage.toolCalls,
            )
        finally:
            sess.close()

    sessionId = chatId
    ch.send_model(ChatEvent(event="RunStarted", sessionId=sessionId))

    assistantMessageId = str(uuid.uuid4())
    assistantContent = ""
    sess = db.session(app_handle)
    try:
        db.append_message(
            sess,
            id=assistantMessageId,
            chatId=chatId,
            role="assistant",
            content="",
            createdAt=datetime.utcnow().isoformat(),
        )
    finally:
        sess.close()

    try:
        agent = create_agent_for_chat(chatId, app_handle)
        
        if not messages or messages[-1].role != "user":
            raise ValueError("No user message found in request")
        
        user_message = messages[-1].content
        
        response_stream = agent.arun(
            user_message, 
            stream=True,
            stream_intermediate_steps=True
        )
        
        content_blocks = []
        current_text_buffer = ""
        tool_call_counter = 0
        
        def flush_text_block():
            nonlocal current_text_buffer
            if current_text_buffer:
                content_blocks.append({"type": "text", "content": current_text_buffer})
                current_text_buffer = ""
        
        def save_content_async(content: str):
            sess = db.session(app_handle)
            try:
                db.update_message_content(sess, messageId=assistantMessageId, content=content)
            finally:
                sess.close()
        
        async for chunk in response_stream:
            if chunk.event == RunEvent.run_content:
                if chunk.content:
                    assistantContent += chunk.content
                    current_text_buffer += chunk.content
                    ch.send_model(ChatEvent(event="RunContent", content=chunk.content))
                    await asyncio.to_thread(save_content_async, assistantContent)
            
            elif chunk.event == RunEvent.tool_call_started:
                tool_id = f"{assistantMessageId}-tool-{tool_call_counter}"
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
                flush_text_block()
                tool_id = f"{assistantMessageId}-tool-{tool_call_counter}"
                tool_call_counter += 1
                
                tool_call_block = {
                    "type": "tool_call",
                    "id": tool_id,
                    "toolName": chunk.tool.tool_name,
                    "toolArgs": chunk.tool.tool_args,
                    "toolResult": str(chunk.tool.result) if chunk.tool.result is not None else None,
                    "isCompleted": True,
                }
                content_blocks.append(tool_call_block)
                ch.send_model(ChatEvent(event="ToolCallCompleted", tool=tool_call_block))
            
            elif chunk.event == RunEvent.run_completed:
                flush_text_block()
                if not content_blocks:
                    content_blocks = [{"type": "text", "content": ""}]
                
                ch.send_model(ChatEvent(event="RunCompleted"))
                
                def save_final():
                    sess = db.session(app_handle)
                    try:
                        db.update_message_content(
                            sess,
                            messageId=assistantMessageId,
                            content=json.dumps(content_blocks),
                            toolCalls=None,
                        )
                    finally:
                        sess.close()
                
                await asyncio.to_thread(save_final)
            
            elif chunk.event == RunEvent.run_error:
                flush_text_block()
                
                error_block = {
                    "type": "error",
                    "message": str(chunk),
                    "timestamp": datetime.utcnow().isoformat()
                }
                content_blocks.append(error_block)
                
                ch.send_model(ChatEvent(event="RunError", content=str(chunk)))
                
                def save_error():
                    sess = db.session(app_handle)
                    try:
                        db.update_message_content(
                            sess,
                            messageId=assistantMessageId,
                            content=json.dumps(content_blocks),
                        )
                    finally:
                        sess.close()
                
                await asyncio.to_thread(save_error)
        
    except Exception as e:
        import traceback
        print(f"[stream_chat] Error: {e}")
        print(traceback.format_exc())
        
        error_block = {
            "type": "error",
            "message": str(e),
            "traceback": traceback.format_exc(),
            "timestamp": datetime.utcnow().isoformat()
        }
        
        sess = db.session(app_handle)
        try:
            db.update_message_content(sess, messageId=assistantMessageId, content=json.dumps([error_block]))
        finally:
            sess.close()
        
        ch.send_model(ChatEvent(event="RunError", content=str(e)))
