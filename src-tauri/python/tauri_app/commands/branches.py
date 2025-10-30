from __future__ import annotations

import json
from typing import Dict, List, Any

from pydantic import BaseModel
from pytauri import AppHandle
from pytauri.ipc import Channel, JavaScriptChannelId
from pytauri.webview import WebviewWindow

from .. import db
from ..models.chat import ChatEvent, ChatMessage
from ..services.agent_factory import create_agent_for_chat
from .streaming import convert_to_agno_messages, handle_content_stream
from . import commands


class ContinueMessageRequest(BaseModel):
    messageId: str
    chatId: str
    channel: JavaScriptChannelId[ChatEvent]


class RetryMessageRequest(BaseModel):
    messageId: str
    chatId: str
    channel: JavaScriptChannelId[ChatEvent]


class EditUserMessageRequest(BaseModel):
    messageId: str
    newContent: str
    chatId: str
    channel: JavaScriptChannelId[ChatEvent]


class SwitchToSiblingRequest(BaseModel):
    messageId: str
    siblingId: str
    chatId: str


class GetMessageSiblingsRequest(BaseModel):
    messageId: str


class MessageSiblingInfo(BaseModel):
    id: str
    sequence: int
    isActive: bool


@commands.command()
async def continue_message(
    body: ContinueMessageRequest,
    webview_window: WebviewWindow,
    app_handle: AppHandle,
) -> None:
    """Continue incomplete assistant message from where it stopped."""
    ch: Channel[ChatEvent] = body.channel.channel_on(webview_window.as_ref_webview())
    
    with db.db_session(app_handle) as sess:
        # Get the message path up to this message
        messages = db.get_message_path(sess, body.messageId)
        
        # Convert to ChatMessage format
        chat_messages = [
            ChatMessage(
                id=m.id,
                role=m.role,
                content=m.content if isinstance(m.content, str) else json.dumps(m.content),
                createdAt=m.createdAt,
            )
            for m in messages
        ]
    
    ch.send_model(ChatEvent(event="RunStarted", sessionId=body.chatId))
    
    try:
        agent = create_agent_for_chat(body.chatId, app_handle)
        
        # Continue streaming into the same message
        await handle_content_stream(
            app_handle,
            agent,
            chat_messages,
            body.messageId,  # Same message ID - append content
            ch,
        )
        
    except Exception as e:
        print(f"[continue_message] Error: {e}")
        ch.send_model(ChatEvent(event="RunError", content=str(e)))


@commands.command()
async def retry_message(
    body: RetryMessageRequest,
    webview_window: WebviewWindow,
    app_handle: AppHandle,
) -> None:
    """Create sibling message and retry generation."""
    ch: Channel[ChatEvent] = body.channel.channel_on(webview_window.as_ref_webview())
    
    with db.db_session(app_handle) as sess:
        # Get the original message to find its parent
        original_msg = sess.get(db.Message, body.messageId)
        if not original_msg:
            ch.send_model(ChatEvent(event="RunError", content="Message not found"))
            return
        
        # Get conversation up to the parent
        if original_msg.parent_message_id:
            messages = db.get_message_path(sess, original_msg.parent_message_id)
        else:
            messages = []
        
        # Convert to ChatMessage format
        chat_messages = [
            ChatMessage(
                id=m.id,
                role=m.role,
                content=m.content if isinstance(m.content, str) else json.dumps(m.content),
                createdAt=m.createdAt,
            )
            for m in messages
        ]
        
        # Create new sibling assistant message
        new_msg_id = db.create_branch_message(
            sess,
            parent_id=original_msg.parent_message_id,
            role="assistant",
            content="",
            chat_id=body.chatId,
            is_complete=False,
        )
        
        # Update active leaf to the new message
        db.set_active_leaf(sess, body.chatId, new_msg_id)
    
    ch.send_model(ChatEvent(event="RunStarted", sessionId=body.chatId))
    
    try:
        agent = create_agent_for_chat(body.chatId, app_handle)
        
        # Stream fresh response
        await handle_content_stream(
            app_handle,
            agent,
            chat_messages,
            new_msg_id,
            ch,
        )
        
    except Exception as e:
        print(f"[retry_message] Error: {e}")
        ch.send_model(ChatEvent(event="RunError", content=str(e)))


@commands.command()
async def edit_user_message(
    body: EditUserMessageRequest,
    webview_window: WebviewWindow,
    app_handle: AppHandle,
) -> None:
    """Edit user message by creating sibling with new content."""
    ch: Channel[ChatEvent] = body.channel.channel_on(webview_window.as_ref_webview())
    
    with db.db_session(app_handle) as sess:
        # Get the original message to find its parent
        original_msg = sess.get(db.Message, body.messageId)
        if not original_msg:
            ch.send_model(ChatEvent(event="RunError", content="Message not found"))
            return
        
        # Get conversation up to the parent (excluding the message being edited)
        if original_msg.parent_message_id:
            messages = db.get_message_path(sess, original_msg.parent_message_id)
        else:
            messages = []
        
        # Create new sibling user message with edited content
        new_user_msg_id = db.create_branch_message(
            sess,
            parent_id=original_msg.parent_message_id,
            role="user",
            content=body.newContent,
            chat_id=body.chatId,
            is_complete=True,
        )
        
        # Update active leaf to the new user message
        db.set_active_leaf(sess, body.chatId, new_user_msg_id)
        
        # Convert to ChatMessage format (including the new user message)
        chat_messages = [
            ChatMessage(
                id=m.id,
                role=m.role,
                content=m.content if isinstance(m.content, str) else json.dumps(m.content),
                createdAt=m.createdAt,
            )
            for m in messages
        ]
        chat_messages.append(
            ChatMessage(
                id=new_user_msg_id,
                role="user",
                content=body.newContent,
                createdAt=original_msg.createdAt,
            )
        )
        
        # Create assistant response message
        assistant_msg_id = db.create_branch_message(
            sess,
            parent_id=new_user_msg_id,
            role="assistant",
            content="",
            chat_id=body.chatId,
            is_complete=False,
        )
        
        # Update active leaf to the assistant message
        db.set_active_leaf(sess, body.chatId, assistant_msg_id)
    
    ch.send_model(ChatEvent(event="RunStarted", sessionId=body.chatId))
    
    try:
        agent = create_agent_for_chat(body.chatId, app_handle)
        
        # Stream response to edited message
        await handle_content_stream(
            app_handle,
            agent,
            chat_messages,
            assistant_msg_id,
            ch,
        )
        
    except Exception as e:
        print(f"[edit_user_message] Error: {e}")
        ch.send_model(ChatEvent(event="RunError", content=str(e)))


@commands.command()
async def switch_to_sibling(
    body: SwitchToSiblingRequest,
    app_handle: AppHandle,
) -> None:
    """Switch active branch to different sibling."""
    with db.db_session(app_handle) as sess:
        # Get the leaf descendant of the sibling
        leaf_id = db.get_leaf_descendant(sess, body.siblingId)
        
        # Update active leaf to point to this branch
        db.set_active_leaf(sess, body.chatId, leaf_id)


@commands.command()
async def get_message_siblings(
    body: GetMessageSiblingsRequest,
    app_handle: AppHandle,
) -> List[MessageSiblingInfo]:
    """Get all sibling messages for navigation UI."""
    with db.db_session(app_handle) as sess:
        message = sess.get(db.Message, body.messageId)
        if not message:
            return []
        
        # Get all siblings (messages with same parent)
        siblings = db.get_message_children(sess, message.parent_message_id)
        
        # Get the chat to determine which is active
        chat = sess.get(db.Chat, message.chatId)
        active_path = []
        if chat and chat.active_leaf_message_id:
            active_path_msgs = db.get_message_path(sess, chat.active_leaf_message_id)
            active_path = [m.id for m in active_path_msgs]
        
        return [
            MessageSiblingInfo(
                id=sib.id,
                sequence=sib.sequence,
                isActive=sib.id in active_path,
            )
            for sib in siblings
        ]

