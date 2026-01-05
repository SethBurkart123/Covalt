from __future__ import annotations

import asyncio
import json
import traceback
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence

from agno.agent import Agent, Message, RunEvent
from agno.media import Audio, File, Image, Video
from pydantic import BaseModel
from rich.logging import RichHandler

from zynk import Channel, command

from .. import db
from ..models.chat import Attachment, ChatEvent, ChatMessage
from ..services.agent_factory import create_agent_for_chat
from ..services.file_storage import (
    get_attachment_path,
    get_extension_from_mime,
    save_attachment_from_base64,
)
from ..services.tool_registry import get_tool_registry
from ..services import stream_broadcaster as broadcaster

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


def extract_error_message(error_content: str) -> str:
    """Extract a clean error message from litellm/provider error strings for cleaner display."""
    if not error_content:
        return "Unknown error"
    
    try:
        json_start = error_content.find('{')
        if json_start != -1:
            json_str = error_content[json_start:]
            data = json.loads(json_str)
            if isinstance(data, dict):
                # {"error": {"message": "..."}} format
                if "error" in data and isinstance(data["error"], dict):
                    return data["error"].get("message", error_content)
                # {"message": "..."} format
                if "message" in data:
                    return data["message"]
    except (json.JSONDecodeError, ValueError):
        pass
    
    return error_content


class BroadcastingChannel:
    """
    Wrapper around a channel that also broadcasts events to all subscribers.
    This allows sync code to call send_model() while broadcasting happens async.
    """
    
    def __init__(self, channel: Any, chat_id: str):
        self._channel = channel
        self._chat_id = chat_id
        self._loop = asyncio.get_event_loop()
        self._pending_broadcasts: list = []
    
    def send_model(self, event: ChatEvent) -> None:
        """Send event to the originating channel and schedule broadcast."""
        self._channel.send_model(event)
        
        if self._chat_id:
            event_dict = event.model_dump() if hasattr(event, 'model_dump') else event.dict()
            task = asyncio.create_task(broadcaster.broadcast_event(self._chat_id, event_dict))
            self._pending_broadcasts.append(task)
    
    async def flush_broadcasts(self) -> None:
        """Wait for all pending broadcasts to complete. Call before unregister_stream."""
        if self._pending_broadcasts:
            await asyncio.gather(*self._pending_broadcasts, return_exceptions=True)
            self._pending_broadcasts.clear()

# Maps run_id -> asyncio.Event for signaling when approval is received
_approval_events: Dict[str, asyncio.Event] = {}

# Global storage for pending approval responses
_approval_responses: Dict[str, Dict[str, Any]] = {}  # approval_id -> {approved: bool, edited_args: dict}

class AttachmentInput(BaseModel):
    """Incoming attachment with base64 data."""

    id: str
    type: str  # "image" | "file" | "audio" | "video"
    name: str
    mimeType: str
    size: int
    data: str  # base64-encoded file content


class StreamChatRequest(BaseModel):
    messages: List[Dict[str, Any]]
    modelId: Optional[str] = None
    chatId: Optional[str] = None
    toolIds: List[str] = []
    attachments: List[AttachmentInput] = []  # File attachments with base64 data

def parse_model_id(model_id: Optional[str]) -> tuple[str, str]:
    """Parse 'provider:model' format."""
    if not model_id:
        return "", ""
    if ":" in model_id:
        provider, model = model_id.split(":", 1)
        return provider, model
    return "", model_id


# TODO: Add file size limit validation (e.g., 50MB per file)
def process_and_save_attachments(
    chat_id: str, attachments: List[AttachmentInput]
) -> List[Attachment]:
    """
    Process incoming attachments: save files to disk and return metadata list.

    Args:
        chat_id: The chat ID for organizing files
        attachments: List of incoming attachments with base64 data

    Returns:
        List of Attachment metadata (without the base64 data)
    """
    saved_attachments: List[Attachment] = []

    for att in attachments:
        extension = get_extension_from_mime(att.mimeType)
        save_attachment_from_base64(chat_id, att.id, att.data, extension)

        saved_attachments.append(
            Attachment(
                id=att.id,
                type=att.type,
                name=att.name,
                mimeType=att.mimeType,
                size=att.size,
            )
        )

    return saved_attachments


def load_attachments_as_agno_media(
    chat_id: str, attachments: List[Attachment]
) -> tuple[
    Sequence[Image], Sequence[File], Sequence[Audio], Sequence[Video]
]:
    """
    Load attachment files from disk and convert to Agno media objects.

    Uses filepath instead of loading bytes - cleaner and more memory efficient!

    Args:
        chat_id: The chat ID
        attachments: List of attachment metadata

    Returns:
        Tuple of (images, files, audio, videos) Agno media objects
    """
    images: List[Image] = []
    files: List[File] = []
    audio: List[Audio] = []
    videos: List[Video] = []

    for att in attachments:
        extension = get_extension_from_mime(att.mimeType)
        filepath = get_attachment_path(chat_id, att.id, extension)

        logger.info(f"[stream] Loading attachment {att.id} from {filepath}")

        if att.type == "image":
            images.append(Image(filepath=filepath))
        elif att.type == "audio":
            audio.append(Audio(filepath=filepath))
        elif att.type == "video":
            videos.append(Video(filepath=filepath))
        else:  # "file" type
            files.append(File(filepath=filepath, name=att.name))

    return images, files, audio, videos


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
            provider, model = parse_model_id(model_id)
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


def save_user_msg(
    msg: ChatMessage,
    chat_id: str,
    parent_id: Optional[str] = None,
    attachments: Optional[List[Attachment]] = None,
):
    """Save user message to db with optional attachments."""
    with db.db_session() as sess:
        sequence = db.get_next_sibling_sequence(sess, parent_id, chat_id)

        # Serialize attachments to JSON if present
        attachments_json = None
        if attachments:
            attachments_json = json.dumps(
                [att.model_dump() for att in attachments]
            )

        message = db.Message(
            id=msg.id,
            chatId=chat_id,
            role=msg.role,
            content=msg.content,
            createdAt=msg.createdAt or datetime.utcnow().isoformat(),
            parent_message_id=parent_id,
            is_complete=True,  # User messages are always complete
            sequence=sequence,
            attachments=attachments_json,
        )
        sess.add(message)
        sess.commit()

        db.set_active_leaf(sess, chat_id, msg.id)


def init_assistant_msg(chat_id: str, parent_id: str) -> str:
    """Create empty assistant message, return id."""
    msg_id = str(uuid.uuid4())
    with db.db_session() as sess:
        sequence = db.get_next_sibling_sequence(sess, parent_id, chat_id)
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
    raw_ch: Any,
    chat_id: str = "",
    images: Optional[Sequence[Image]] = None,
    files: Optional[Sequence[File]] = None,
    audio: Optional[Sequence[Audio]] = None,
    videos: Optional[Sequence[Video]] = None,
):
    ch = BroadcastingChannel(raw_ch, chat_id) if chat_id else raw_ch
    
    agno_messages = []
    for msg in messages:
        agno_messages.extend(convert_to_agno_messages(msg))

    if chat_id:
        await broadcaster.register_stream(chat_id, assistant_msg_id)

    parse_think_tags = False
    try:
        with db.db_session() as sess:
            msg = sess.get(db.Message, assistant_msg_id)
            if msg and msg.model_used:
                parts = msg.model_used.split(":", 1)
                if len(parts) == 2:
                    provider, model_id = parts
                    model_settings = db.get_model_settings(sess, provider, model_id)
                    if model_settings:
                        parse_think_tags = model_settings.parse_think_tags
    except Exception as e:
        logger.info(f"[stream] Warning: Failed to check parse_think_tags: {e}")

    # Pass media attachments to agent.arun() if provided
    if images:
        logger.info(f"[stream] Passing {len(images)} images to agent.arun()")
    if files:
        logger.info(f"[stream] Passing {len(files)} files to agent.arun()")
    response_stream = agent.arun(
        input=agno_messages,
        images=images if images else None,
        files=files if files else None,
        audio=audio if audio else None,
        videos=videos if videos else None,
        stream=True,
        stream_events=True,
    )

    content_blocks = load_initial_content(assistant_msg_id)
    current_text = ""
    current_reasoning = ""
    had_error = False
    run_id = None

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
            current_text += content
            return

        think_tag_buffer += content

        while True:
            if not inside_think_tag:
                open_idx = think_tag_buffer.find("<think>")
                if open_idx == -1:
                    if len(think_tag_buffer) > 6:
                        text_chunk = think_tag_buffer[:-6]
                        current_text += text_chunk
                        ch.send_model(ChatEvent(event="RunContent", content=text_chunk))
                        think_tag_buffer = think_tag_buffer[-6:]
                    break
                else:
                    if open_idx > 0:
                        text_chunk = think_tag_buffer[:open_idx]
                        current_text += text_chunk
                        ch.send_model(ChatEvent(event="RunContent", content=text_chunk))
                    think_tag_buffer = think_tag_buffer[open_idx + 7:]
                    inside_think_tag = True

                    if current_text:
                        flush_text()
                    ch.send_model(ChatEvent(event="ReasoningStarted"))
            else:
                close_idx = think_tag_buffer.find("</think>")
                if close_idx == -1:
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
                    if close_idx > 0:
                        reasoning_chunk = think_tag_buffer[:close_idx]
                        current_reasoning += reasoning_chunk
                        ch.send_model(
                            ChatEvent(
                                event="ReasoningStep", reasoningContent=reasoning_chunk
                            )
                        )
                    think_tag_buffer = think_tag_buffer[close_idx + 8:]
                    inside_think_tag = False

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

    try:
        while True:
            async for chunk in response_stream:
                if not run_id and chunk.run_id:
                    run_id = chunk.run_id
                    _active_runs[assistant_msg_id] = (run_id, agent)
                    logger.info(f"[stream] Captured run_id {run_id}")
                    if chat_id:
                        await broadcaster.update_stream_run_id(chat_id, run_id)

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
                    if chat_id:
                        await broadcaster.update_stream_status(chat_id, "completed")
                        await broadcaster.unregister_stream(chat_id)
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
                        "renderer": registry.get_renderer(chunk.tool.tool_name),
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
                    await asyncio.to_thread(
                        save_msg_content, assistant_msg_id, save_final()
                    )

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
                    await ch.flush_broadcasts()
                    if chat_id:
                        await broadcaster.update_stream_status(chat_id, "completed")
                        await broadcaster.unregister_stream(chat_id)
                    return

                elif chunk.event == RunEvent.run_error:
                    flush_think_tag_buffer()
                    flush_text()
                    flush_reasoning()
                    raw_error = chunk.content if chunk.content else str(chunk)
                    error_msg = extract_error_message(raw_error)
                    content_blocks.append(
                        {
                            "type": "error",
                            "content": error_msg,
                            "timestamp": datetime.utcnow().isoformat(),
                        }
                    )
                    await asyncio.to_thread(save_msg_content, assistant_msg_id, save_final())
                    ch.send_model(ChatEvent(event="RunError", content=error_msg))
                    had_error = True
                    await ch.flush_broadcasts()
                    if chat_id:
                        await broadcaster.update_stream_status(chat_id, "error", error_msg)
                        await broadcaster.unregister_stream(chat_id)
                    return

                elif chunk.event == RunEvent.run_paused:
                    flush_text()
                    flush_reasoning()
                    
                    if chat_id:
                        await broadcaster.update_stream_status(chat_id, "paused_hitl")
                    
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

                        if chat_id:
                            await broadcaster.update_stream_status(chat_id, "streaming")

                        response_stream = agent.acontinue_run(
                            run_id=run_id,
                            updated_tools=chunk.tools,
                            stream=True,
                            stream_events=True,
                        )
                        break

            else:
                break

    except asyncio.CancelledError:
        if run_id and run_id in _approval_events:
            _approval_events.pop(run_id, None)
            _approval_responses.pop(run_id, None)
        raise
        
    except Exception as e:
        logger.error(f"[stream] Exception in stream handler: {e}")
        flush_think_tag_buffer()
        flush_text()
        flush_reasoning()
        try:
            await asyncio.to_thread(save_msg_content, assistant_msg_id, save_final())
        except Exception as save_err:
            logger.error(f"[stream] Failed to save state on error: {save_err}")
        
        if chat_id:
            await broadcaster.update_stream_status(chat_id, "error", str(e))
            await broadcaster.unregister_stream(chat_id)

    if assistant_msg_id in _active_runs:
        del _active_runs[assistant_msg_id]

    if not had_error:
        with db.db_session() as sess:
            message = sess.get(db.Message, assistant_msg_id)
            if message and not message.is_complete:
                db.mark_message_complete(sess, assistant_msg_id)
        if chat_id:
            await broadcaster.update_stream_status(chat_id, "completed")
            await broadcaster.unregister_stream(chat_id)


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
            if content[i : i + 7] == "<think>":
                if current_text:
                    blocks.append({"type": "text", "content": current_text})
                    current_text = ""
                inside_think_tag = True
                i += 7
            else:
                current_text += content[i]
                i += 1
        else:
            if content[i : i + 8] == "</think>":
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

    if current_text:
        blocks.append({"type": "text", "content": current_text})
    if current_reasoning:
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

            try:
                current_content = json.loads(msg.content)
            except (json.JSONDecodeError, TypeError):
                current_content = msg.content

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

            if "<think>" not in text_content:
                logger.info(f"[reprocess] No think tags found in message {message_id}")
                return False

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

        with db.db_session() as sess:
            db.mark_message_complete(sess, message_id)

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

    # Process and save attachments if provided
    saved_attachments: List[Attachment] = []
    images: Sequence[Image] = []
    files: Sequence[File] = []
    audio: Sequence[Audio] = []
    videos: Sequence[Video] = []

    if body.attachments:
        logger.info(f"[stream] Processing {len(body.attachments)} attachments for chat {chat_id}")
        saved_attachments = process_and_save_attachments(chat_id, body.attachments)
        images, files, audio, videos = load_attachments_as_agno_media(
            chat_id, saved_attachments
        )
        logger.info(f"[stream] Loaded media: {len(images)} images, {len(files)} files, {len(audio)} audio, {len(videos)} videos")

    with db.db_session() as sess:
        chat = sess.get(db.Chat, chat_id)
        parent_id = chat.active_leaf_message_id if chat else None

    if messages and messages[-1].role == "user":
        save_user_msg(
            messages[-1],
            chat_id,
            parent_id,
            attachments=saved_attachments if saved_attachments else None,
        )
        parent_id = messages[-1].id

    channel.send_model(ChatEvent(event="RunStarted", sessionId=chat_id))

    assistant_msg_id = init_assistant_msg(chat_id, parent_id)

    channel.send_model(ChatEvent(event="AssistantMessageId", content=assistant_msg_id))

    try:
        agent = create_agent_for_chat(
            chat_id,
            tool_ids=body.toolIds,
        )

        if not messages or messages[-1].role != "user":
            raise ValueError("No user message found in request")

        await handle_content_stream(
            agent,
            messages,
            assistant_msg_id,
            channel,
            chat_id=chat_id,
            images=images if images else None,
            files=files if files else None,
            audio=audio if audio else None,
            videos=videos if videos else None,
        )

    except Exception as e:
        logger.info(f"[stream] Error: {e}")
        
        if chat_id:
            await broadcaster.update_stream_status(chat_id, "error", str(e))
            await broadcaster.unregister_stream(chat_id)

        error_block = {
            "type": "error",
            "content": str(e),
            "traceback": traceback.format_exc(),
            "timestamp": datetime.utcnow().isoformat(),
        }

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
        channel.send_model(ChatEvent(event="RunError", content=str(e)))


# ============ Multi-Frontend Stream Commands ============


class ActiveStreamInfo(BaseModel):
    """Information about an active stream."""
    chatId: str
    messageId: str
    status: str  # streaming, paused_hitl, completed, error, interrupted
    errorMessage: Optional[str] = None


class ActiveStreamsResponse(BaseModel):
    """Response containing all active streams."""
    streams: List[ActiveStreamInfo]


class SubscribeToStreamRequest(BaseModel):
    """Request to subscribe to a stream."""
    chatId: str


class ClearStreamRequest(BaseModel):
    """Request to clear a stream record (after user acknowledges)."""
    chatId: str


@command
async def get_active_streams() -> ActiveStreamsResponse:
    """
    Get all active and recently completed/errored streams.
    Used by frontend on initialization to discover running streams.
    """
    streams = await broadcaster.get_all_active_streams()
    return ActiveStreamsResponse(
        streams=[
            ActiveStreamInfo(
                chatId=s["chatId"],
                messageId=s["messageId"],
                status=s["status"],
                errorMessage=s.get("errorMessage"),
            )
            for s in streams
        ]
    )


@command
async def subscribe_to_stream(
    channel: Channel,
    body: SubscribeToStreamRequest,
) -> None:
    """
    Subscribe to events for an already-running stream.
    
    This allows new frontends (or page reloads) to receive
    live events for an existing stream.
    """
    chat_id = body.chatId
    
    queue = await broadcaster.subscribe(chat_id)
    
    if queue is None:
        channel.send_model(ChatEvent(event="StreamNotActive", content=chat_id))
        return
    
    channel.send_model(ChatEvent(event="StreamSubscribed", content=chat_id))
    
    try:
        while True:
            event = await queue.get()
            
            if event is None:
                break
            
            channel.send_model(ChatEvent(**event))
            
    except asyncio.CancelledError:
        pass
    finally:
        await broadcaster.unsubscribe(chat_id, queue)


@command
async def clear_stream_record(body: ClearStreamRequest) -> dict:
    """
    Clear a stream record from the database.
    Called when user acknowledges an interrupted/error stream.
    """
    await broadcaster.clear_stream_record(body.chatId)
    return {"success": True}
