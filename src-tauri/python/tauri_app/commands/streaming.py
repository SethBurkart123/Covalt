from __future__ import annotations

import uuid
from datetime import datetime
from typing import List, Optional, Dict, Any

from pytauri import AppHandle
from pytauri.ipc import Channel, JavaScriptChannelId, Headers
from pytauri.webview import WebviewWindow

from .. import db
from ..models.chat import ChatEvent, ChatMessage
from ..services.agent_factory import create_agent_for_chat
from . import commands


@commands.command()
async def stream_chat(
    body: JavaScriptChannelId[ChatEvent],
    headers: Headers,
    webview_window: WebviewWindow,
    app_handle: AppHandle,
) -> None:
    """Stream chat completions via a Channel to the frontend.
    
    Saves messages incrementally to DB:
    - User message saved immediately
    - Assistant message created and updated as content streams
    """
    ch: Channel[ChatEvent] = body.channel_on(webview_window.as_ref_webview())

    # Parse payload from headers
    payloadRaw: Optional[str] = None
    try:
        try:
            items = headers.items()  # type: ignore[attr-defined]
        except Exception:
            items = headers  # type: ignore[assignment]
        for k, v in items:  # type: ignore[misc]
            ks = (k.decode("utf-8", "ignore") if isinstance(k, (bytes, bytearray)) else str(k)).lower()
            if ks == "x-stream-payload":
                payloadRaw = (
                    v.decode("utf-8", "ignore") if isinstance(v, (bytes, bytearray)) else str(v)
                )
                break
    except Exception:
        payloadRaw = None

    messages: List[ChatMessage] = []
    modelId: Optional[str] = None
    chatId: Optional[str] = None
    
    if payloadRaw:
        try:
            import json
            data: Dict[str, Any] = json.loads(payloadRaw)
            if isinstance(data.get("messages"), list):
                msgs: List[Dict[str, Any]] = data["messages"]
                messages = [
                    ChatMessage(
                        id=m.get("id"),
                        role=m.get("role"),
                        content=m.get("content", ""),
                        createdAt=m.get("createdAt"),
                        toolCalls=m.get("toolCalls"),
                    )
                    for m in msgs
                ]
            modelId = data.get("modelId")
            chatId = data.get("chatId")
        except Exception:
            pass

    # Parse provider and model from modelId (format: "provider:modelId")
    provider = "openai"
    actual_model_id = "gpt-4o-mini"
    if modelId and ":" in modelId:
        parts = modelId.split(":", 1)
        provider = parts[0]
        actual_model_id = parts[1]
    elif modelId:
        # Fallback: try to guess provider or use as-is
        actual_model_id = modelId

    # Create new chat if needed
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
            # Set initial agent config with provider and model
            config = {
                "provider": provider,
                "model_id": actual_model_id,
                "tool_ids": [],
                "instructions": [],
            }
            db.update_chat_agent_config(sess, chatId=chatId, config=config)
        finally:
            sess.close()
    else:
        # Update existing chat's agent config with selected model
        sess = db.session(app_handle)
        try:
            config = db.get_chat_agent_config(sess, chatId)
            if not config:
                config = db.get_default_agent_config()
            config["provider"] = provider
            config["model_id"] = actual_model_id
            db.update_chat_agent_config(sess, chatId=chatId, config=config)
        finally:
            sess.close()

    # Save user message to DB immediately
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

    # Create assistant message placeholder
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

    # Stream from Agno agent and update DB incrementally
    try:
        # Create fresh Agno agent instance for this request
        agent = create_agent_for_chat(chatId, app_handle)
        
        # Get the last user message
        if not messages or messages[-1].role != "user":
            raise ValueError("No user message found in request")
        
        user_message = messages[-1].content
        
        # Run agent with streaming
        # Agno's stream format: yields strings (content deltas) or may not stream at all
        response_stream = agent.run(user_message, stream=True)
        
        # Parse stream chunks
        # Agno typically yields either strings or RunResponse-like objects
        for chunk in response_stream:
            # Handle string chunks (most common case)
            if isinstance(chunk, str):
                if chunk:  # Skip empty strings
                    assistantContent += chunk
                    
                    # Update DB with accumulated content
                    sess = db.session(app_handle)
                    try:
                        db.update_message_content(
                            sess,
                            messageId=assistantMessageId,
                            content=assistantContent,
                        )
                    finally:
                        sess.close()
                    
                    ch.send_model(ChatEvent(event="RunContent", content=chunk))
            
            # Handle object chunks (RunResponse or similar)
            elif chunk is not None:
                # Try to extract content
                content = None
                if hasattr(chunk, 'content'):
                    content = chunk.content
                elif hasattr(chunk, 'delta') and hasattr(chunk.delta, 'content'):
                    content = chunk.delta.content
                
                if content:
                    content_str = str(content)
                    assistantContent += content_str
                    
                    # Update DB
                    sess = db.session(app_handle)
                    try:
                        db.update_message_content(
                            sess,
                            messageId=assistantMessageId,
                            content=assistantContent,
                        )
                    finally:
                        sess.close()
                    
                    ch.send_model(ChatEvent(event="RunContent", content=content_str))
                
                # Check for tool calls (if present in chunk)
                if hasattr(chunk, 'tool_calls') and chunk.tool_calls:
                    for tool_call in chunk.tool_calls:
                        tool_data = {
                            "name": getattr(tool_call, 'name', 'unknown'),
                            "args": getattr(tool_call, 'arguments', {}),
                            "result": getattr(tool_call, 'result', None),
                        }
                        ch.send_model(ChatEvent(event="ToolCall", tool=tool_data))
        
        # Ensure we have some content
        if not assistantContent:
            # If streaming didn't produce anything, get the final response
            # This happens when stream=True doesn't actually stream
            if hasattr(response_stream, 'content'):
                assistantContent = str(response_stream.content)
                sess = db.session(app_handle)
                try:
                    db.update_message_content(
                        sess,
                        messageId=assistantMessageId,
                        content=assistantContent,
                    )
                finally:
                    sess.close()
                ch.send_model(ChatEvent(event="RunContent", content=assistantContent))
        
        # Signal completion
        ch.send_model(ChatEvent(event="RunCompleted"))
        
    except Exception as e:
        import traceback
        print(f"[stream_chat] Error: {e}")
        print(traceback.format_exc())
        
        errorMsg = f"\n\n[Error: {e}]"
        assistantContent += errorMsg
        
        # Save error to DB
        sess = db.session(app_handle)
        try:
            db.update_message_content(
                sess,
                messageId=assistantMessageId,
                content=assistantContent,
            )
        finally:
            sess.close()
        
        ch.send_model(ChatEvent(event="RunCompleted", content=errorMsg))
