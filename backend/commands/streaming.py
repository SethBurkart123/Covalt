from __future__ import annotations

import asyncio
import json
import traceback
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from agno.agent import Agent, Message, RunEvent
from pydantic import BaseModel
from rich.logging import RichHandler

from zynk import Channel, command

from .. import db
from ..models.chat import ChatEvent, ChatMessage
from ..services.agent_factory import create_agent_for_chat
from ..services.tool_registry import get_tool_registry

import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
    datefmt="[%X]",
    handlers=[RichHandler(rich_tracebacks=True)]
)
logger = logging.getLogger(__name__)

registry = get_tool_registry()
_active_runs: Dict[str, tuple] = {}  # message_id -> (run_id, agent)

# Maps run_id -> asyncio.Event for signaling when approval is received
_approval_events: Dict[str, asyncio.Event] = {}

# Global storage for pending approval responses
_approval_responses: Dict[str, Dict[str, Any]] = {}  # approval_id -> {approved: bool, edited_args: dict}

class StreamChatRequest(BaseModel):
    messages: List[Dict[str, Any]]
    modelId: Optional[str] = None
    chatId: Optional[str] = None

def parse_model_id(model_id: Optional[str]) -> tuple[str, str]:
    """Parse 'provider:model' format."""
    if not model_id:
        return "", ""
    if ":" in model_id:
        provider, model = model_id.split(":", 1)
        return provider, model
    return "", model_id


def ensure_chat_initialized(chat_id: Optional[str], model_id: Optional[str]) -> str:
    """
    Create chat and config if needed, and ensure model/provider are up to date.

    Returns the chat_id.
    """
    if not chat_id:
        chat_id = str(uuid.uuid4())
        with db.db_session() as sess:
            now = datetime.utcnow().isoformat()
            db.create_chat(
                sess,
                id=chat_id,
                title="New Chat",
                model=model_id,
                createdAt=now,
                updatedAt=now,
            )
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
    with db.db_session() as sess:
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
            if (provider and provider != cur_provider) or (
                model and model != cur_model
            ):
                if provider:
                    config["provider"] = provider
                if model:
                    config["model_id"] = model
                db.update_chat_agent_config(sess, chatId=chat_id, config=config)

    return chat_id


def save_user_msg(msg: ChatMessage, chat_id: str, parent_id: Optional[str] = None):
    """Save user message to db."""
    with db.db_session() as sess:
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


def init_assistant_msg(chat_id: str, parent_id: str) -> str:
    """Create empty assistant message, return id."""
    msg_id = str(uuid.uuid4())
    with db.db_session() as sess:
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


def save_msg_content(msg_id: str, content: str):
    """Update message content."""
    with db.db_session() as sess:
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
                    messages.append(
                        Message(
                            role="assistant",
                            content=" ".join(text_parts),
                            tool_calls=[
                                {
                                    "id": block.id,
                                    "type": "function",
                                    "function": {
                                        "name": block.toolName,
                                        "arguments": json.dumps(block.toolArgs or {}),
                                    },
                                }
                            ],
                        )
                    )
                    text_parts = []
                else:
                    messages.append(
                        Message(
                            role="assistant",
                            content=None,
                            tool_calls=[
                                {
                                    "id": block.id,
                                    "type": "function",
                                    "function": {
                                        "name": block.toolName,
                                        "arguments": json.dumps(block.toolArgs or {}),
                                    },
                                }
                            ],
                        )
                    )

                if block.toolResult:
                    messages.append(
                        Message(
                            role="tool",
                            tool_call_id=block.id,
                            content=str(block.toolResult),
                        )
                    )

        if text_parts:
            messages.append(Message(role="assistant", content=" ".join(text_parts)))

        return messages if messages else [Message(role="assistant", content="")]

    return []


def load_initial_content(msg_id: str) -> List[Dict[str, Any]]:
    """Load existing message content for continuation."""
    try:
        with db.db_session() as sess:
            message = sess.get(db.Message, msg_id)
            if not message or not message.content:
                return []

            raw = message.content.strip()
            blocks = (
                json.loads(raw)
                if raw.startswith("[")
                else [{"type": "text", "content": raw}]
            )

            while blocks and blocks[-1].get("type") == "error":
                blocks.pop()

            return blocks
    except Exception as e:
        logger.info(f"[stream] Warning loading initial content: {e}")
        return []


async def handle_content_stream(
    agent: Agent,
    messages: List[ChatMessage],
    assistant_msg_id: str,
    ch: Any,  # Channel type - keeping flexible for now
):
    agno_messages = []
    for msg in messages:
        agno_messages.extend(convert_to_agno_messages(msg))

    # Check if we should parse think tags for this model
    parse_think_tags = False
    try:
        with db.db_session() as sess:
            msg = sess.get(db.Message, assistant_msg_id)
            if msg and msg.model_used:
                # Parse provider:model_id format
                parts = msg.model_used.split(":", 1)
                if len(parts) == 2:
                    provider, model_id = parts
                    model_settings = db.get_model_settings(sess, provider, model_id)
                    if model_settings:
                        parse_think_tags = model_settings.parse_think_tags
    except Exception as e:
        logger.info(f"[stream] Warning: Failed to check parse_think_tags: {e}")

    response_stream = agent.arun(input=agno_messages, stream=True, stream_events=True)

    content_blocks = load_initial_content(assistant_msg_id)
    current_text = ""
    current_reasoning = ""
    had_error = False
    run_id = None

    # State for parsing think tags
    think_tag_buffer = ""
    inside_think_tag = False

    def flush_text():
        nonlocal current_text
        if current_text:
            content_blocks.append({"type": "text", "content": current_text})
            current_text = ""

    def flush_reasoning():
        nonlocal current_reasoning
        if current_reasoning:
            content_blocks.append(
                {"type": "reasoning", "content": current_reasoning, "isCompleted": True}
            )
            current_reasoning = ""

    def flush_think_tag_buffer():
        """Flush any remaining content in the think tag buffer."""
        nonlocal think_tag_buffer, inside_think_tag, current_text, current_reasoning

        if not parse_think_tags or not think_tag_buffer:
            return

        if inside_think_tag:
            # If we're still inside a think tag, treat remaining buffer as reasoning
            current_reasoning += think_tag_buffer
            flush_reasoning()
        else:
            # Otherwise treat it as text
            current_text += think_tag_buffer

        think_tag_buffer = ""
        inside_think_tag = False

    def process_content_with_think_tags(content: str):
        """Parse content and handle <think> tags if enabled."""
        nonlocal current_text, current_reasoning, think_tag_buffer, inside_think_tag

        if not parse_think_tags:
            # Not parsing, just add to current text
            current_text += content
            return

        # Process character by character to handle streaming
        think_tag_buffer += content

        while True:
            if not inside_think_tag:
                # Look for opening tag
                open_idx = think_tag_buffer.find("<think>")
                if open_idx == -1:
                    # No opening tag, emit everything except last 6 chars (in case partial tag)
                    if len(think_tag_buffer) > 6:
                        text_chunk = think_tag_buffer[:-6]
                        current_text += text_chunk
                        ch.send_model(ChatEvent(event="RunContent", content=text_chunk))
                        think_tag_buffer = think_tag_buffer[-6:]
                    break
                else:
                    # Found opening tag
                    if open_idx > 0:
                        # Emit text before tag
                        text_chunk = think_tag_buffer[:open_idx]
                        current_text += text_chunk
                        ch.send_model(ChatEvent(event="RunContent", content=text_chunk))
                    think_tag_buffer = think_tag_buffer[
                        open_idx + 7 :
                    ]  # Skip '<think>'
                    inside_think_tag = True

                    # Flush any pending text and start reasoning
                    if current_text:
                        flush_text()
                    ch.send_model(ChatEvent(event="ReasoningStarted"))
            else:
                # Look for closing tag
                close_idx = think_tag_buffer.find("</think>")
                if close_idx == -1:
                    # No closing tag yet, emit everything except last 8 chars (in case partial tag)
                    if len(think_tag_buffer) > 8:
                        reasoning_chunk = think_tag_buffer[:-8]
                        current_reasoning += reasoning_chunk
                        ch.send_model(
                            ChatEvent(
                                event="ReasoningStep", reasoningContent=reasoning_chunk
                            )
                        )
                        think_tag_buffer = think_tag_buffer[-8:]
                    break
                else:
                    # Found closing tag
                    if close_idx > 0:
                        # Emit reasoning content before tag
                        reasoning_chunk = think_tag_buffer[:close_idx]
                        current_reasoning += reasoning_chunk
                        ch.send_model(
                            ChatEvent(
                                event="ReasoningStep", reasoningContent=reasoning_chunk
                            )
                        )
                    think_tag_buffer = think_tag_buffer[
                        close_idx + 8 :
                    ]  # Skip '</think>'
                    inside_think_tag = False

                    # Flush reasoning and complete it
                    flush_reasoning()
                    ch.send_model(ChatEvent(event="ReasoningCompleted"))

    def save_state():
        temp = content_blocks.copy()
        if current_text:
            temp.append({"type": "text", "content": current_text})
        if current_reasoning:
            temp.append(
                {
                    "type": "reasoning",
                    "content": current_reasoning,
                    "isCompleted": False,
                }
            )
        return json.dumps(temp)

    def save_final():
        return json.dumps(content_blocks)

    while True:
        async for chunk in response_stream:
            if not run_id and chunk.run_id:
                run_id = chunk.run_id
                _active_runs[assistant_msg_id] = (run_id, agent)
                logger.info(f"[stream] Captured run_id {run_id}")

            if chunk.event == RunEvent.run_cancelled:
                flush_think_tag_buffer()
                flush_text()
                flush_reasoning()
                await asyncio.to_thread(save_msg_content, assistant_msg_id, save_final())
                with db.db_session() as sess:
                    db.mark_message_complete(sess, assistant_msg_id)
                if assistant_msg_id in _active_runs:
                    del _active_runs[assistant_msg_id]
                ch.send_model(ChatEvent(event="RunCancelled"))
                return

            if chunk.event == RunEvent.run_content:
                if chunk.reasoning_content:
                    if current_text and not current_reasoning:
                        flush_text()
                    current_reasoning += chunk.reasoning_content
                    ch.send_model(
                        ChatEvent(
                            event="ReasoningStep", reasoningContent=chunk.reasoning_content
                        )
                    )
                    await asyncio.to_thread(
                        save_msg_content, assistant_msg_id, save_state()
                    )

                if chunk.content:
                    if current_reasoning and not current_text and not parse_think_tags:
                        flush_reasoning()

                    if parse_think_tags:
                        process_content_with_think_tags(chunk.content)
                    else:
                        current_text += chunk.content
                        ch.send_model(ChatEvent(event="RunContent", content=chunk.content))

                    await asyncio.to_thread(
                        save_msg_content, assistant_msg_id, save_state()
                    )

            elif chunk.event == RunEvent.tool_call_started:
                flush_text()
                flush_reasoning()

                ch.send_model(
                    ChatEvent(
                        event="ToolCallStarted",
                        tool={
                            "id": chunk.tool.tool_call_id,
                            "toolName": chunk.tool.tool_name,
                            "toolArgs": chunk.tool.tool_args,
                            "isCompleted": False,
                        },
                    )
                )

            elif chunk.event == RunEvent.tool_call_completed:
                flush_text()
                flush_reasoning()

                tool_block = {
                    "type": "tool_call",
                    "id": chunk.tool.tool_call_id,
                    "toolName": chunk.tool.tool_name,
                    "toolArgs": chunk.tool.tool_args,
                    "toolResult": str(chunk.tool.result)
                    if chunk.tool.result is not None
                    else None,
                    "isCompleted": True,
                }

                existing_index = next(
                    (
                        i
                        for i, block in enumerate(content_blocks)
                        if block.get("type") == "tool_call"
                        and block.get("id") == tool_block["id"]
                    ),
                    None,
                )
                if existing_index is not None:
                    content_blocks[existing_index] = tool_block
                else:
                    content_blocks.append(tool_block)
                ch.send_model(ChatEvent(event="ToolCallCompleted", tool=tool_block))

            elif chunk.event == RunEvent.reasoning_started:
                flush_text()
                ch.send_model(ChatEvent(event="ReasoningStarted"))

            elif chunk.event == RunEvent.reasoning_step:
                if chunk.reasoning_content:
                    if current_text:
                        flush_text()
                    current_reasoning += chunk.reasoning_content
                    ch.send_model(
                        ChatEvent(
                            event="ReasoningStep", reasoningContent=chunk.reasoning_content
                        )
                    )
                    await asyncio.to_thread(
                        save_msg_content, assistant_msg_id, save_state()
                    )

            elif chunk.event == RunEvent.reasoning_completed:
                flush_reasoning()
                ch.send_model(ChatEvent(event="ReasoningCompleted"))

            elif chunk.event == RunEvent.run_completed:
                flush_think_tag_buffer()
                flush_text()
                flush_reasoning()
                await asyncio.to_thread(save_msg_content, assistant_msg_id, save_final())
                with db.db_session() as sess:
                    db.mark_message_complete(sess, assistant_msg_id)
                ch.send_model(ChatEvent(event="RunCompleted"))
                return

            elif chunk.event == RunEvent.run_error:
                flush_think_tag_buffer()
                flush_text()
                flush_reasoning()
                content_blocks.append(
                    {
                        "type": "error",
                        "content": str(
                            chunk.error.message
                            if hasattr(chunk.error, "message")
                            else chunk
                        ),
                        "timestamp": datetime.utcnow().isoformat(),
                    }
                )
                await asyncio.to_thread(save_msg_content, assistant_msg_id, save_final())
                ch.send_model(ChatEvent(event="RunError", content=str(chunk)))
                had_error = True
                return

            elif chunk.event == RunEvent.run_paused:
                flush_text()
                flush_reasoning()
                
                if hasattr(chunk, "tools_requiring_confirmation") and chunk.tools_requiring_confirmation:
                    tools_info = []
                    for tool in chunk.tools_requiring_confirmation:
                        editable_args = registry.get_editable_args(tool.tool_name)
                        tool_block = {
                            "type": "tool_call",
                            "id": tool.tool_call_id,
                            "toolName": tool.tool_name,
                            "toolArgs": tool.tool_args,
                            "isCompleted": False,
                            "requiresApproval": True,
                            "approvalStatus": "pending",
                        }
                        content_blocks.append(tool_block)
                        tool_info = {
                            "id": tool.tool_call_id,
                            "toolName": tool.tool_name,
                            "toolArgs": tool.tool_args,
                        }
                        if editable_args:
                            tool_info["editableArgs"] = editable_args
                        tools_info.append(tool_info)

                    await asyncio.to_thread(save_msg_content, assistant_msg_id, save_state())

                    ch.send_model(
                        ChatEvent(
                            event="ToolApprovalRequired",
                            tool={"runId": run_id, "tools": tools_info},
                        )
                    )

                    approval_event = asyncio.Event()
                    _approval_events[run_id] = approval_event

                    timed_out = False
                    try:
                        await asyncio.wait_for(approval_event.wait(), timeout=300)
                    except asyncio.TimeoutError:
                        timed_out = True
                        for tool in chunk.tools_requiring_confirmation:
                            tool.confirmed = False
                    else:
                        response = _approval_responses.get(run_id, {})
                        tool_decisions = response.get("tool_decisions", {})
                        edited_args = response.get("edited_args", {})
                        default_approved = response.get("approved", False)
                        for tool in chunk.tools_requiring_confirmation:
                            tool_id = getattr(tool, "tool_call_id", None)
                            tool.confirmed = tool_decisions.get(tool_id, default_approved)
                            if tool_id and tool_id in edited_args:
                                tool.tool_args = edited_args[tool_id]

                    _approval_events.pop(run_id, None)
                    _approval_responses.pop(run_id, None)

                    for tool in chunk.tools_requiring_confirmation:
                        tool_id = tool.tool_call_id
                        if timed_out:
                            status = "timeout"
                        else:
                            status = "approved" if tool.confirmed else "denied"
                        for block in content_blocks:
                            if block.get("type") == "tool_call" and block.get("id") == tool_id:
                                block["approvalStatus"] = status
                                block["toolArgs"] = tool.tool_args
                                if status in ("denied", "timeout"):
                                    block["isCompleted"] = True
                        ch.send_model(ChatEvent(
                            event="ToolApprovalResolved",
                            tool={"id": tool_id, "approvalStatus": status, "toolArgs": tool.tool_args},
                        ))

                    await asyncio.to_thread(save_msg_content, assistant_msg_id, save_state())

                    response_stream = agent.acontinue_run(
                        run_id=run_id,
                        updated_tools=chunk.tools,
                        stream=True,
                        stream_events=True,
                    )
                    break

        else:
            # this should never happen, but if it does, we need to break out of the loop
            break

    if assistant_msg_id in _active_runs:
        del _active_runs[assistant_msg_id]

    if not had_error:
        with db.db_session() as sess:
            message = sess.get(db.Message, assistant_msg_id)
            if message and not message.is_complete:
                db.mark_message_complete(sess, assistant_msg_id)


def parse_think_tags_from_content(content: str) -> List[Dict[str, Any]]:
    """
    Parse content and extract <think> tags, converting to content blocks.
    Returns list of content blocks with reasoning extracted.
    """
    blocks = []
    current_text = ""
    current_reasoning = ""
    inside_think_tag = False
    i = 0

    while i < len(content):
        if not inside_think_tag:
            # Look for <think>
            if content[i : i + 7] == "<think>":
                # Flush any pending text
                if current_text:
                    blocks.append({"type": "text", "content": current_text})
                    current_text = ""
                inside_think_tag = True
                i += 7
            else:
                current_text += content[i]
                i += 1
        else:
            # Look for </think>
            if content[i : i + 8] == "</think>":
                # Flush reasoning
                if current_reasoning:
                    blocks.append(
                        {
                            "type": "reasoning",
                            "content": current_reasoning,
                            "isCompleted": True,
                        }
                    )
                    current_reasoning = ""
                inside_think_tag = False
                i += 8
            else:
                current_reasoning += content[i]
                i += 1

    # Flush any remaining content
    if current_text:
        blocks.append({"type": "text", "content": current_text})
    if current_reasoning:
        # If we're still inside a think tag at the end, treat it as reasoning
        blocks.append(
            {"type": "reasoning", "content": current_reasoning, "isCompleted": True}
        )

    return blocks if blocks else [{"type": "text", "content": ""}]


def reprocess_message_with_think_tags(message_id: str) -> bool:
    """
    Re-process a message's content to parse <think> tags.
    Returns True if message was updated, False otherwise.
    """
    try:
        with db.db_session() as sess:
            msg = sess.get(db.Message, message_id)
            if not msg:
                logger.info(f"[reprocess] Message {message_id} not found")
                return False

            # Parse the current content
            try:
                current_content = json.loads(msg.content)
            except (json.JSONDecodeError, TypeError):
                current_content = msg.content

            # If content is already blocks, extract text content
            text_content = ""
            if isinstance(current_content, list):
                for block in current_content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        text_content += block.get("content", "")
            elif isinstance(current_content, str):
                text_content = current_content
            else:
                logger.info(f"[reprocess] Unknown content format for message {message_id}")
                return False

            # Check if there are any think tags
            if "<think>" not in text_content:
                logger.info(f"[reprocess] No think tags found in message {message_id}")
                return False

            # Parse and update
            new_blocks = parse_think_tags_from_content(text_content)
            msg.content = json.dumps(new_blocks)
            sess.commit()

            logger.info(
                f"[reprocess] Successfully parsed think tags for message {message_id}"
            )
            return True

    except Exception as e:
        logger.info(f"[reprocess] Error reprocessing message {message_id}: {e}")
        traceback.print_exc()
        return False


class CancelRunRequest(BaseModel):
    messageId: str


class RespondToToolApprovalInput(BaseModel):
    runId: str
    approved: bool
    toolDecisions: Optional[Dict[str, bool]] = None
    editedArgs: Optional[Dict[str, Dict[str, Any]]] = None


@command
async def respond_to_tool_approval(body: RespondToToolApprovalInput) -> dict:
    """
    Respond to a tool approval request using Agno's native HITL API.

    This stores the approval response and signals the waiting streaming handler
    to continue the run with updated tool confirmations.
    """
    run_id = body.runId

    _approval_responses[run_id] = {
        "approved": body.approved,
        "tool_decisions": body.toolDecisions or {},
        "edited_args": body.editedArgs or {},
    }

    # Signal the waiting event if it exists
    if run_id in _approval_events:
        _approval_events[run_id].set()

    return {"success": True}


@command
async def cancel_run(body: CancelRunRequest) -> dict:
    """Cancel an active streaming run. Returns {cancelled: bool}"""
    message_id = body.messageId

    if message_id not in _active_runs:
        logger.info(f"[cancel_run] No active run found for message {message_id}")
        return {"cancelled": False}

    run_id, agent = _active_runs[message_id]

    try:
        logger.info(f"[cancel_run] Cancelling run {run_id} for message {message_id}")
        agent.cancel_run(run_id)

        # Mark message as complete in database
        with db.db_session() as sess:
            db.mark_message_complete(sess, message_id)

        # Clean up tracking
        del _active_runs[message_id]

        logger.info(f"[cancel_run] Successfully cancelled run {run_id}")
        return {"cancelled": True}
    except Exception as e:
        logger.info(f"[cancel_run] Error cancelling run: {e}")
        return {"cancelled": False}


@command
async def stream_chat(
    channel: Channel,
    body: StreamChatRequest,
) -> None:
    ch = channel
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

    chat_id = ensure_chat_initialized(body.chatId, body.modelId)

    # Get the current active leaf to use as parent
    with db.db_session() as sess:
        chat = sess.get(db.Chat, chat_id)
        parent_id = chat.active_leaf_message_id if chat else None

    if messages and messages[-1].role == "user":
        save_user_msg(messages[-1], chat_id, parent_id)
        # Update parent_id to the newly saved user message
        parent_id = messages[-1].id

    ch.send_model(ChatEvent(event="RunStarted", sessionId=chat_id))

    assistant_msg_id = init_assistant_msg(chat_id, parent_id)

    ch.send_model(ChatEvent(event="AssistantMessageId", content=assistant_msg_id))

    try:
        agent = create_agent_for_chat(
            chat_id, channel=ch, assistant_msg_id=assistant_msg_id
        )

        if not messages or messages[-1].role != "user":
            raise ValueError("No user message found in request")

        await handle_content_stream(
            agent,
            messages,
            assistant_msg_id,
            ch,
        )

    except Exception as e:
        logger.info(f"[stream] Error: {e}")

        error_block = {
            "type": "error",
            "content": str(e),
            "traceback": traceback.format_exc(),
            "timestamp": datetime.utcnow().isoformat(),
        }

        # Preserve any existing content and append the error block
        try:
            with db.db_session() as sess:
                message = sess.get(db.Message, assistant_msg_id)
                blocks: List[Dict[str, Any]] = []
                if message and message.content:
                    raw = message.content.strip()
                    if raw.startswith("["):
                        try:
                            blocks = json.loads(raw)
                        except Exception:
                            blocks = [{"type": "text", "content": message.content}]
                    else:
                        blocks = [{"type": "text", "content": message.content}]
                blocks.append(error_block)
                db.update_message_content(
                    sess, messageId=assistant_msg_id, content=json.dumps(blocks)
                )
        except Exception as e2:
            logger.info(f"[stream] Failed to append error block, falling back: {e2}")
            save_msg_content(assistant_msg_id, json.dumps([error_block]))
        ch.send_model(ChatEvent(event="RunError", content=str(e)))
        # Note: message stays is_complete=False so user can retry/continue
