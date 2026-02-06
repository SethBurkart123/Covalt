from __future__ import annotations

import asyncio
import json
import traceback
import uuid
import copy
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence

from agno.agent import Agent, Message, RunEvent
from agno.media import Audio, File, Image, Video
from agno.run.agent import BaseAgentRunEvent
from agno.run.team import BaseTeamRunEvent
from agno.team import Team
from agno.team.team import TeamRunEvent
from pydantic import BaseModel
from rich.logging import RichHandler

from zynk import Channel, command

from .. import db
from ..models.chat import Attachment, ChatEvent, ChatMessage
from ..services.agent_factory import create_agent_for_chat
from ..services.agent_manager import get_agent_manager
from ..services.graph_executor import build_agent_from_graph
from ..services.file_storage import (
    get_extension_from_mime,
    get_pending_attachment_path,
)
from ..services.tool_registry import get_tool_registry
from ..services.toolset_executor import get_toolset_executor
from ..services import stream_broadcaster as broadcaster
from ..services.workspace_manager import get_workspace_manager

import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
    datefmt="[%X]",
    handlers=[RichHandler(rich_tracebacks=True)],
)
logger = logging.getLogger(__name__)

_TEAM_TO_RUN_EVENT: dict[TeamRunEvent, RunEvent] = {
    getattr(TeamRunEvent, e.name): e for e in RunEvent if hasattr(TeamRunEvent, e.name)
}


def _normalize_event(event: RunEvent | TeamRunEvent | str) -> RunEvent | None:
    """Normalize a TeamRunEvent or raw event string to its RunEvent equivalent."""
    if isinstance(event, RunEvent):
        return event
    if isinstance(event, TeamRunEvent):
        return _TEAM_TO_RUN_EVENT.get(event)
    if isinstance(event, str):
        try:
            return RunEvent(event)
        except ValueError:
            pass
        try:
            return _TEAM_TO_RUN_EVENT.get(TeamRunEvent(event))
        except ValueError:
            pass
    return None


DELEGATION_TOOL_NAMES = {"delegate_task_to_member", "delegate_task_to_members"}


def _is_delegation_tool(tool_name: str | None) -> bool:
    return tool_name in DELEGATION_TOOL_NAMES


def _is_member_event(chunk: Any) -> bool:
    return isinstance(chunk, BaseAgentRunEvent)


def _is_team_event(chunk: Any) -> bool:
    return isinstance(chunk, BaseTeamRunEvent)


@dataclass
class MemberRunState:
    run_id: str
    name: str
    block_index: int
    current_text: str = ""
    current_reasoning: str = ""


registry = get_tool_registry()
_active_runs: Dict[str, tuple] = {}  # message_id -> (run_id, agent)


def extract_error_message(error_content: str) -> str:
    if not error_content:
        return "Unknown error"

    json_start = error_content.find("{")
    if json_start != -1:
        try:
            data = json.loads(error_content[json_start:])
            if isinstance(data, dict):
                if "error" in data and isinstance(data["error"], dict):
                    return data["error"].get("message", error_content)
                if "message" in data:
                    return data["message"]
        except json.JSONDecodeError:
            pass

    return error_content


def is_toolset_tool(tool_name: str) -> bool:
    return (
        ":" in tool_name
        and not tool_name.startswith("mcp:")
        and not tool_name.startswith("-")
    )


def parse_tool_result(result: Any) -> dict[str, Any]:
    if isinstance(result, dict):
        return result
    if isinstance(result, str):
        try:
            parsed = json.loads(result)
            return parsed if isinstance(parsed, dict) else {"result": parsed}
        except json.JSONDecodeError:
            return {"result": result}
    return {"result": result}


class BroadcastingChannel:
    def __init__(self, channel: Any, chat_id: str):
        self._channel = channel
        self._chat_id = chat_id
        self._loop = asyncio.get_event_loop()
        self._pending_broadcasts: list = []

    def send_model(self, event: ChatEvent) -> None:
        self._channel.send_model(event)

        if self._chat_id:
            event_dict = (
                event.model_dump() if hasattr(event, "model_dump") else event.dict()
            )
            self._pending_broadcasts.append(
                asyncio.create_task(
                    broadcaster.broadcast_event(self._chat_id, event_dict)
                )
            )

    async def flush_broadcasts(self) -> None:
        if self._pending_broadcasts:
            await asyncio.gather(*self._pending_broadcasts, return_exceptions=True)
            self._pending_broadcasts.clear()


_approval_events: Dict[str, asyncio.Event] = {}

_approval_responses: Dict[
    str, Dict[str, Any]
] = {}  # approval_id -> {approved: bool, edited_args: dict}


class AttachmentInput(BaseModel):
    id: str
    type: str
    name: str
    mimeType: str
    size: int
    data: str


class AttachmentMeta(BaseModel):
    id: str
    type: str
    name: str
    mimeType: str
    size: int


class StreamChatRequest(BaseModel):
    messages: List[Dict[str, Any]]
    modelId: Optional[str] = None
    chatId: Optional[str] = None
    toolIds: List[str] = []
    attachments: List[AttachmentMeta] = []


def parse_model_id(model_id: Optional[str]) -> tuple[str, str]:
    if not model_id:
        return "", ""
    if ":" in model_id:
        provider, model = model_id.split(":", 1)
        return provider, model
    return "", model_id


MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

AGNO_ALLOWED_ATTACHMENT_MIME_TYPES = [
    "image/*",
    "audio/*",
    "video/*",
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/json",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
]


def is_allowed_attachment_mime(mime_type: str) -> bool:
    if not mime_type:
        return False
    for prefix, wildcard in [
        ("image/", "image/*"),
        ("audio/", "audio/*"),
        ("video/", "video/*"),
    ]:
        if mime_type.startswith(prefix):
            return wildcard in AGNO_ALLOWED_ATTACHMENT_MIME_TYPES
    return mime_type in AGNO_ALLOWED_ATTACHMENT_MIME_TYPES


def load_attachments_as_agno_media(
    chat_id: str, attachments: List[Attachment]
) -> tuple[Sequence[Image], Sequence[File], Sequence[Audio], Sequence[Video]]:
    images: List[Image] = []
    files: List[File] = []
    audio: List[Audio] = []
    videos: List[Video] = []

    workspace_manager = get_workspace_manager(chat_id)

    for att in attachments:
        if att.size > MAX_ATTACHMENT_BYTES:
            logger.warning(
                f"[attachments] Skipping {att.id} ({att.name}): {att.size} bytes exceeds {MAX_ATTACHMENT_BYTES}"
            )
            continue

        if not is_allowed_attachment_mime(att.mimeType):
            logger.warning(
                f"[attachments] Skipping {att.id} ({att.name}): MIME '{att.mimeType}' not allowed for Agno"
            )
            continue

        filepath = workspace_manager.workspace_dir / att.name
        if not filepath.exists():
            logger.warning(
                f"[attachments] Skipping {att.id} ({att.name}): file not found in workspace"
            )
            continue

        if att.type == "image":
            images.append(Image(filepath=filepath))
        elif att.type == "audio":
            audio.append(Audio(filepath=filepath))
        elif att.type == "video":
            videos.append(Video(filepath=filepath))
        else:
            files.append(File(filepath=filepath, name=att.name))

    return images, files, audio, videos


def ensure_chat_initialized(chat_id: Optional[str], model_id: Optional[str]) -> str:
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
    manifest_id: Optional[str] = None,
):
    with db.db_session() as sess:
        now = datetime.utcnow().isoformat()
        message = db.Message(
            id=msg.id,
            chatId=chat_id,
            role=msg.role,
            content=msg.content,
            createdAt=msg.createdAt or now,
            parent_message_id=parent_id,
            is_complete=True,
            sequence=db.get_next_sibling_sequence(sess, parent_id, chat_id),
            attachments=json.dumps([att.model_dump() for att in attachments])
            if attachments
            else None,
            manifest_id=manifest_id,
        )
        sess.add(message)
        sess.commit()

        db.set_active_leaf(sess, chat_id, msg.id)
        db.update_chat(sess, id=chat_id, updatedAt=now)


def init_assistant_msg(chat_id: str, parent_id: str) -> str:
    msg_id = str(uuid.uuid4())
    with db.db_session() as sess:
        now = datetime.utcnow().isoformat()
        model_used = None
        try:
            config = db.get_chat_agent_config(sess, chat_id)
            if config:
                provider = config.get("provider") or ""
                model_id = config.get("model_id") or ""
                model_used = (
                    f"{provider}:{model_id}"
                    if provider and model_id
                    else (model_id or None)
                )
        except Exception:
            pass

        message = db.Message(
            id=msg_id,
            chatId=chat_id,
            role="assistant",
            content="",
            createdAt=now,
            parent_message_id=parent_id,
            is_complete=False,
            sequence=db.get_next_sibling_sequence(sess, parent_id, chat_id),
            model_used=model_used,
        )
        sess.add(message)
        sess.commit()

        db.set_active_leaf(sess, chat_id, msg_id)
        db.update_chat(sess, id=chat_id, updatedAt=now)
    return msg_id


def save_msg_content(msg_id: str, content: str):
    with db.db_session() as sess:
        db.update_message_content(sess, messageId=msg_id, content=content)


def convert_to_agno_messages(
    chat_msg: ChatMessage,
    chat_id: Optional[str] = None,
) -> List[Message]:
    if chat_msg.role == "user":
        content = chat_msg.content
        if isinstance(content, list):
            content = json.dumps(content)

        images_list: Optional[List[Image]] = None
        files_list: Optional[List[File]] = None
        audio_list: Optional[List[Audio]] = None
        videos_list: Optional[List[Video]] = None

        if chat_id and chat_msg.attachments:
            images, files, audio, videos = load_attachments_as_agno_media(
                chat_id, chat_msg.attachments
            )
            if images:
                images_list = list(images)
            if files:
                files_list = list(files)
            if audio:
                audio_list = list(audio)
            if videos:
                videos_list = list(videos)

        return [
            Message(
                role="user",
                content=content,
                images=images_list,
                files=files_list,
                audio=audio_list,
                videos=videos_list,
            )
        ]

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
    agent: Agent | Team,
    messages: List[ChatMessage],
    assistant_msg_id: str,
    raw_ch: Any,
    chat_id: str = "",
    ephemeral: bool = False,
):
    ch = BroadcastingChannel(raw_ch, chat_id) if chat_id else raw_ch

    def _noop_save(msg_id: str, content: str) -> None:
        pass

    _save = save_msg_content if not ephemeral else _noop_save

    agno_messages = []
    for msg in messages:
        agno_messages.extend(convert_to_agno_messages(msg, chat_id))

    if chat_id:
        await broadcaster.register_stream(chat_id, assistant_msg_id)

    run_input: Any = (
        agno_messages if isinstance(agent, Agent) else agno_messages[-1].content
    )
    response_stream = agent.arun(
        input=run_input,
        stream=True,
        stream_events=True,
    )

    content_blocks = [] if ephemeral else load_initial_content(assistant_msg_id)
    current_text = ""
    current_reasoning = ""
    had_error = False
    run_id = None

    active_delegation_tool_id: str | None = None
    delegation_task: str = ""
    member_runs: dict[str, MemberRunState] = {}

    def _get_member_run(chunk: Any) -> MemberRunState:
        rid = str(getattr(chunk, "run_id", "") or "")
        if rid in member_runs:
            ms = member_runs[rid]
            name = getattr(chunk, "agent_name", "") or ""
            if name:
                ms.name = name
                content_blocks[ms.block_index]["memberName"] = name
            return ms

        name = getattr(chunk, "agent_name", "") or "Member"
        block = {
            "type": "member_run",
            "runId": rid,
            "memberName": name,
            "content": [],
            "isCompleted": False,
            "task": delegation_task,
        }
        content_blocks.append(block)
        idx = len(content_blocks) - 1
        ms = MemberRunState(run_id=rid, name=name, block_index=idx)
        member_runs[rid] = ms
        ch.send_model(
            ChatEvent(
                event="MemberRunStarted",
                memberName=name,
                memberRunId=rid,
                task=delegation_task,
            )
        )
        return ms

    async def _handle_member_event(evt: RunEvent, chunk: Any):
        ms = _get_member_run(chunk)
        member_content = content_blocks[ms.block_index]["content"]
        rid = ms.run_id
        name = ms.name

        def _make_event(**kwargs: Any) -> ChatEvent:
            return ChatEvent(memberRunId=rid, memberName=name, **kwargs)

        if evt == RunEvent.run_content:
            if getattr(chunk, "reasoning_content", None):
                text = chunk.reasoning_content
                if ms.current_text and not ms.current_reasoning:
                    member_content.append({"type": "text", "content": ms.current_text})
                    ms.current_text = ""
                ms.current_reasoning += text
                ch.send_model(_make_event(event="ReasoningStep", reasoningContent=text))

            if chunk.content:
                text = chunk.content
                if ms.current_reasoning and not ms.current_text:
                    member_content.append(
                        {
                            "type": "reasoning",
                            "content": ms.current_reasoning,
                            "isCompleted": True,
                        }
                    )
                    ms.current_reasoning = ""
                ms.current_text += text
                ch.send_model(_make_event(event="RunContent", content=text))

            await asyncio.to_thread(_save, assistant_msg_id, save_state())

        elif evt == RunEvent.reasoning_started:
            if ms.current_text:
                member_content.append({"type": "text", "content": ms.current_text})
                ms.current_text = ""
            ch.send_model(_make_event(event="ReasoningStarted"))

        elif evt in (RunEvent.reasoning_step, RunEvent.reasoning_content_delta):
            text = getattr(chunk, "reasoning_content", "") or ""
            if text:
                if ms.current_text:
                    member_content.append({"type": "text", "content": ms.current_text})
                    ms.current_text = ""
                ms.current_reasoning += text
                ch.send_model(_make_event(event="ReasoningStep", reasoningContent=text))
                await asyncio.to_thread(_save, assistant_msg_id, save_state())

        elif evt == RunEvent.reasoning_completed:
            if ms.current_reasoning:
                member_content.append(
                    {
                        "type": "reasoning",
                        "content": ms.current_reasoning,
                        "isCompleted": True,
                    }
                )
                ms.current_reasoning = ""
            ch.send_model(_make_event(event="ReasoningCompleted"))
            await asyncio.to_thread(_save, assistant_msg_id, save_state())

        elif evt == RunEvent.tool_call_started:
            if ms.current_text:
                member_content.append({"type": "text", "content": ms.current_text})
                ms.current_text = ""
            if ms.current_reasoning:
                member_content.append(
                    {
                        "type": "reasoning",
                        "content": ms.current_reasoning,
                        "isCompleted": True,
                    }
                )
                ms.current_reasoning = ""
            member_content.append(
                {
                    "type": "tool_call",
                    "id": chunk.tool.tool_call_id,
                    "toolName": chunk.tool.tool_name,
                    "toolArgs": chunk.tool.tool_args,
                    "isCompleted": False,
                }
            )
            ch.send_model(
                _make_event(
                    event="ToolCallStarted",
                    tool={
                        "id": chunk.tool.tool_call_id,
                        "toolName": chunk.tool.tool_name,
                        "toolArgs": chunk.tool.tool_args,
                        "isCompleted": False,
                    },
                )
            )

        elif evt == RunEvent.tool_call_completed:
            tool_result = (
                str(chunk.tool.result) if chunk.tool.result is not None else None
            )
            for block in member_content:
                if (
                    block["type"] == "tool_call"
                    and block.get("id") == chunk.tool.tool_call_id
                ):
                    block["isCompleted"] = True
                    block["toolResult"] = tool_result
                    break
            ch.send_model(
                _make_event(
                    event="ToolCallCompleted",
                    tool={
                        "id": chunk.tool.tool_call_id,
                        "toolName": chunk.tool.tool_name,
                        "toolResult": tool_result,
                    },
                )
            )
            await asyncio.to_thread(_save, assistant_msg_id, save_state())

        elif evt == RunEvent.run_completed:
            pass

    def _flush_all_member_runs():
        for ms in member_runs.values():
            member_content = content_blocks[ms.block_index]["content"]
            if ms.current_text:
                member_content.append({"type": "text", "content": ms.current_text})
                ms.current_text = ""
            if ms.current_reasoning:
                member_content.append(
                    {
                        "type": "reasoning",
                        "content": ms.current_reasoning,
                        "isCompleted": True,
                    }
                )
                ms.current_reasoning = ""
            content_blocks[ms.block_index]["isCompleted"] = True
            ch.send_model(
                ChatEvent(
                    event="MemberRunCompleted",
                    memberName=ms.name,
                    memberRunId=ms.run_id,
                )
            )
        member_runs.clear()

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

    def save_state():
        temp = copy.deepcopy(content_blocks)
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
        for ms in member_runs.values():
            if (
                ms.block_index < len(temp)
                and temp[ms.block_index].get("type") == "member_run"
            ):
                member_content = temp[ms.block_index]["content"]
                if ms.current_text:
                    member_content.append({"type": "text", "content": ms.current_text})
                if ms.current_reasoning:
                    member_content.append(
                        {
                            "type": "reasoning",
                            "content": ms.current_reasoning,
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

                evt = _normalize_event(chunk.event)
                if evt is None:
                    continue

                if active_delegation_tool_id and _is_member_event(chunk):
                    await _handle_member_event(evt, chunk)
                    continue

                if evt == RunEvent.run_cancelled:
                    flush_text()
                    flush_reasoning()
                    await asyncio.to_thread(_save, assistant_msg_id, save_final())
                    if not ephemeral:
                        with db.db_session() as sess:
                            db.mark_message_complete(sess, assistant_msg_id)
                    _active_runs.pop(assistant_msg_id, None)
                    ch.send_model(ChatEvent(event="RunCancelled"))
                    if chat_id:
                        await broadcaster.update_stream_status(chat_id, "completed")
                        await broadcaster.unregister_stream(chat_id)
                    return

                if evt == RunEvent.run_content:
                    if chunk.reasoning_content:
                        if current_text and not current_reasoning:
                            flush_text()
                        current_reasoning += chunk.reasoning_content
                        ch.send_model(
                            ChatEvent(
                                event="ReasoningStep",
                                reasoningContent=chunk.reasoning_content,
                            )
                        )
                        await asyncio.to_thread(_save, assistant_msg_id, save_state())

                    if chunk.content:
                        if current_reasoning and not current_text:
                            flush_reasoning()
                        current_text += chunk.content
                        ch.send_model(
                            ChatEvent(event="RunContent", content=chunk.content)
                        )
                        await asyncio.to_thread(_save, assistant_msg_id, save_state())

                elif evt == RunEvent.tool_call_started:
                    if _is_team_event(chunk) and _is_delegation_tool(
                        chunk.tool.tool_name
                    ):
                        flush_text()
                        flush_reasoning()
                        active_delegation_tool_id = chunk.tool.tool_call_id
                        delegation_task = (chunk.tool.tool_args or {}).get("task", "")
                        continue

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

                elif evt == RunEvent.tool_call_completed:
                    if (
                        active_delegation_tool_id
                        and _is_team_event(chunk)
                        and _is_delegation_tool(chunk.tool.tool_name)
                        and chunk.tool.tool_call_id == active_delegation_tool_id
                    ):
                        _flush_all_member_runs()
                        active_delegation_tool_id = None
                        delegation_task = ""
                        await asyncio.to_thread(_save, assistant_msg_id, save_final())
                        continue

                    flush_text()
                    flush_reasoning()

                    render_plan = None
                    if is_toolset_tool(chunk.tool.tool_name):
                        toolset_executor = get_toolset_executor()
                        parsed_result = parse_tool_result(chunk.tool.result)
                        render_plan = toolset_executor.generate_render_plan(
                            chunk.tool.tool_name,
                            chunk.tool.tool_args or {},
                            parsed_result,
                            chat_id,
                        )

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
                    if render_plan is not None:
                        tool_block["renderPlan"] = render_plan

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
                    await asyncio.to_thread(_save, assistant_msg_id, save_final())

                elif evt == RunEvent.reasoning_started:
                    flush_text()
                    ch.send_model(ChatEvent(event="ReasoningStarted"))

                elif evt == RunEvent.reasoning_step:
                    if chunk.reasoning_content:
                        if current_text:
                            flush_text()
                        current_reasoning += chunk.reasoning_content
                        ch.send_model(
                            ChatEvent(
                                event="ReasoningStep",
                                reasoningContent=chunk.reasoning_content,
                            )
                        )
                        await asyncio.to_thread(_save, assistant_msg_id, save_state())

                elif evt == RunEvent.reasoning_completed:
                    flush_reasoning()
                    ch.send_model(ChatEvent(event="ReasoningCompleted"))

                elif evt == RunEvent.run_completed:
                    flush_text()
                    flush_reasoning()
                    await asyncio.to_thread(_save, assistant_msg_id, save_final())
                    if not ephemeral:
                        with db.db_session() as sess:
                            db.mark_message_complete(sess, assistant_msg_id)
                    ch.send_model(ChatEvent(event="RunCompleted"))
                    await ch.flush_broadcasts()
                    if chat_id:
                        await broadcaster.update_stream_status(chat_id, "completed")
                        await broadcaster.unregister_stream(chat_id)
                    return

                elif evt == RunEvent.run_error:
                    flush_text()
                    flush_reasoning()
                    error_msg = extract_error_message(
                        chunk.content if chunk.content else str(chunk)
                    )
                    content_blocks.append(
                        {
                            "type": "error",
                            "content": error_msg,
                            "timestamp": datetime.utcnow().isoformat(),
                        }
                    )
                    await asyncio.to_thread(_save, assistant_msg_id, save_final())
                    ch.send_model(ChatEvent(event="RunError", content=error_msg))
                    had_error = True
                    await ch.flush_broadcasts()
                    if chat_id:
                        await broadcaster.update_stream_status(
                            chat_id, "error", error_msg
                        )
                        await broadcaster.unregister_stream(chat_id)
                    return

                elif evt == RunEvent.run_paused:
                    flush_text()
                    flush_reasoning()

                    if chat_id:
                        await broadcaster.update_stream_status(chat_id, "paused_hitl")

                    if (
                        hasattr(chunk, "tools_requiring_confirmation")
                        and chunk.tools_requiring_confirmation
                    ):
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

                        await asyncio.to_thread(_save, assistant_msg_id, save_state())
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
                                tool.confirmed = tool_decisions.get(
                                    tool_id, default_approved
                                )
                                if tool_id and tool_id in edited_args:
                                    tool.tool_args = edited_args[tool_id]

                        _approval_events.pop(run_id, None)
                        _approval_responses.pop(run_id, None)

                        for tool in chunk.tools_requiring_confirmation:
                            tool_id = tool.tool_call_id
                            status = (
                                "timeout"
                                if timed_out
                                else ("approved" if tool.confirmed else "denied")
                            )
                            for block in content_blocks:
                                if (
                                    block.get("type") == "tool_call"
                                    and block.get("id") == tool_id
                                ):
                                    block["approvalStatus"] = status
                                    block["toolArgs"] = tool.tool_args
                                    if status in ("denied", "timeout"):
                                        block["isCompleted"] = True
                            ch.send_model(
                                ChatEvent(
                                    event="ToolApprovalResolved",
                                    tool={
                                        "id": tool_id,
                                        "approvalStatus": status,
                                        "toolArgs": tool.tool_args,
                                    },
                                )
                            )

                        await asyncio.to_thread(_save, assistant_msg_id, save_state())

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
        if run_id:
            _approval_events.pop(run_id, None)
            _approval_responses.pop(run_id, None)
        raise
    except Exception as e:
        logger.error(f"[stream] Exception in stream handler: {e}")
        flush_text()
        flush_reasoning()
        try:
            await asyncio.to_thread(_save, assistant_msg_id, save_final())
        except Exception as save_err:
            logger.error(f"[stream] Failed to save state on error: {save_err}")

        if chat_id:
            await broadcaster.update_stream_status(chat_id, "error", str(e))
            await broadcaster.unregister_stream(chat_id)

    _active_runs.pop(assistant_msg_id, None)

    if not had_error and not ephemeral:
        with db.db_session() as sess:
            message = sess.get(db.Message, assistant_msg_id)
            if message and not message.is_complete:
                db.mark_message_complete(sess, assistant_msg_id)
        if chat_id:
            await broadcaster.update_stream_status(chat_id, "completed")
            await broadcaster.unregister_stream(chat_id)


class CancelRunRequest(BaseModel):
    messageId: str


class RespondToToolApprovalInput(BaseModel):
    runId: str
    approved: bool
    toolDecisions: Optional[Dict[str, bool]] = None
    editedArgs: Optional[Dict[str, Dict[str, Any]]] = None


@command
async def respond_to_tool_approval(body: RespondToToolApprovalInput) -> dict:
    _approval_responses[body.runId] = {
        "approved": body.approved,
        "tool_decisions": body.toolDecisions or {},
        "edited_args": body.editedArgs or {},
    }
    if body.runId in _approval_events:
        _approval_events[body.runId].set()
    return {"success": True}


@command
async def cancel_run(body: CancelRunRequest) -> dict:
    if body.messageId not in _active_runs:
        logger.info(f"[cancel_run] No active run found for message {body.messageId}")
        return {"cancelled": False}

    run_id, agent = _active_runs[body.messageId]
    try:
        logger.info(
            f"[cancel_run] Cancelling run {run_id} for message {body.messageId}"
        )
        agent.cancel_run(run_id)
        with db.db_session() as sess:
            db.mark_message_complete(sess, body.messageId)
        del _active_runs[body.messageId]
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
    saved_attachments = []
    manifest_id = None
    file_renames = {}

    if body.attachments:
        logger.info(
            f"[stream] Processing {len(body.attachments)} attachments for chat {chat_id}"
        )

        files_to_add: List[tuple[str, bytes]] = []
        for att in body.attachments:
            extension = get_extension_from_mime(att.mimeType)
            pending_path = get_pending_attachment_path(att.id, extension)

            if pending_path.exists():
                content = pending_path.read_bytes()
                files_to_add.append((att.name, content))
                logger.info(f"[stream] Loaded pending file: {att.name}")
            else:
                logger.warning(
                    f"[stream] Attachment {att.id} ({att.name}) not found in pending storage"
                )
                continue

        if files_to_add:
            with db.db_session() as sess:
                chat = sess.get(db.Chat, chat_id)
                parent_msg_id = chat.active_leaf_message_id if chat else None
                parent_manifest_id = (
                    db.get_manifest_for_message(sess, parent_msg_id)
                    if parent_msg_id
                    else None
                )

            workspace_manager = get_workspace_manager(chat_id)
            manifest_id, file_renames = workspace_manager.add_files(
                files=files_to_add,
                parent_manifest_id=parent_manifest_id,
                source="user_upload",
                source_ref=messages[-1].id if messages else None,
            )

            for att in body.attachments:
                saved_attachments.append(
                    Attachment(
                        id=att.id,
                        type=att.type,
                        name=file_renames.get(att.name, att.name),
                        mimeType=att.mimeType,
                        size=att.size,
                    )
                )

            for att in body.attachments:
                extension = get_extension_from_mime(att.mimeType)
                pending_path = get_pending_attachment_path(att.id, extension)
                if pending_path.exists():
                    pending_path.unlink()

            logger.info(
                f"[stream] Added {len(files_to_add)} files to workspace, {len(file_renames)} renamed"
            )

    with db.db_session() as sess:
        chat = sess.get(db.Chat, chat_id)
        parent_id = chat.active_leaf_message_id if chat else None

    if messages and messages[-1].role == "user":
        if saved_attachments:
            messages[-1].attachments = saved_attachments
        save_user_msg(
            messages[-1],
            chat_id,
            parent_id,
            attachments=saved_attachments or None,
            manifest_id=manifest_id,
        )
        parent_id = messages[-1].id

    channel.send_model(
        ChatEvent(event="RunStarted", sessionId=chat_id, fileRenames=file_renames)
    )

    assistant_msg_id = init_assistant_msg(chat_id, parent_id)

    channel.send_model(ChatEvent(event="AssistantMessageId", content=assistant_msg_id))

    try:
        agent = create_agent_for_chat(chat_id, tool_ids=body.toolIds)
        if not messages or messages[-1].role != "user":
            raise ValueError("No user message found in request")
        await handle_content_stream(
            agent, messages, assistant_msg_id, channel, chat_id=chat_id
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
                blocks = []
                if message and message.content:
                    raw = message.content.strip()
                    try:
                        blocks = (
                            json.loads(raw)
                            if raw.startswith("[")
                            else [{"type": "text", "content": message.content}]
                        )
                    except Exception:
                        blocks = [{"type": "text", "content": message.content}]
                blocks.append(error_block)
                db.update_message_content(
                    sess, messageId=assistant_msg_id, content=json.dumps(blocks)
                )
        except Exception as e2:
            logger.info(f"[stream] Failed to append error block, falling back: {e2}")
            save_msg_content(assistant_msg_id, json.dumps([error_block]))
        channel.send_model(ChatEvent(event="RunError", content=str(e)))


class StreamAgentChatRequest(BaseModel):
    agentId: str
    messages: List[Dict[str, Any]]
    chatId: Optional[str] = None
    ephemeral: bool = False


@command
async def stream_agent_chat(
    channel: Channel,
    body: StreamAgentChatRequest,
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

    agent_manager = get_agent_manager()
    agent_data = agent_manager.get_agent(body.agentId)
    if not agent_data:
        channel.send_model(
            ChatEvent(event="RunError", content=f"Agent '{body.agentId}' not found")
        )
        return

    ephemeral = body.ephemeral

    if ephemeral:
        chat_id = ""
        assistant_msg_id = str(uuid.uuid4())
    else:
        chat_id = ensure_chat_initialized(body.chatId, None)
        with db.db_session() as sess:
            chat = sess.get(db.Chat, chat_id)
            parent_id = chat.active_leaf_message_id if chat else None
        if messages and messages[-1].role == "user":
            save_user_msg(messages[-1], chat_id, parent_id)
            parent_id = messages[-1].id
        assistant_msg_id = init_assistant_msg(chat_id, parent_id)

    channel.send_model(ChatEvent(event="RunStarted", sessionId=chat_id or None))
    channel.send_model(ChatEvent(event="AssistantMessageId", content=assistant_msg_id))

    try:
        agent = build_agent_from_graph(
            agent_data["graph_data"], chat_id=chat_id or None
        )
        if not messages or messages[-1].role != "user":
            raise ValueError("No user message found in request")
        await handle_content_stream(
            agent,
            messages,
            assistant_msg_id,
            channel,
            chat_id=chat_id,
            ephemeral=ephemeral,
        )
    except Exception as e:
        logger.error(f"[stream_agent] Error: {e}")
        traceback.print_exc()

        if chat_id:
            await broadcaster.update_stream_status(chat_id, "error", str(e))
            await broadcaster.unregister_stream(chat_id)

        if not ephemeral:
            error_block = {
                "type": "error",
                "content": str(e),
                "traceback": traceback.format_exc(),
                "timestamp": datetime.utcnow().isoformat(),
            }
            try:
                with db.db_session() as sess:
                    message = sess.get(db.Message, assistant_msg_id)
                    blocks = []
                    if message and message.content:
                        raw = message.content.strip()
                        try:
                            blocks = (
                                json.loads(raw)
                                if raw.startswith("[")
                                else [{"type": "text", "content": message.content}]
                            )
                        except Exception:
                            blocks = [{"type": "text", "content": message.content}]
                    blocks.append(error_block)
                    db.update_message_content(
                        sess, messageId=assistant_msg_id, content=json.dumps(blocks)
                    )
            except Exception as e2:
                logger.error(f"[stream_agent] Failed to append error block: {e2}")
                save_msg_content(assistant_msg_id, json.dumps([error_block]))
        channel.send_model(ChatEvent(event="RunError", content=str(e)))


class ActiveStreamInfo(BaseModel):
    chatId: str
    messageId: str
    status: str
    errorMessage: Optional[str] = None


class ActiveStreamsResponse(BaseModel):
    streams: List[ActiveStreamInfo]


class SubscribeToStreamRequest(BaseModel):
    chatId: str


class ClearStreamRequest(BaseModel):
    chatId: str


@command
async def get_active_streams() -> ActiveStreamsResponse:
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
async def subscribe_to_stream(channel: Channel, body: SubscribeToStreamRequest) -> None:
    queue = await broadcaster.subscribe(body.chatId)
    if queue is None:
        channel.send_model(ChatEvent(event="StreamNotActive", content=body.chatId))
        return

    channel.send_model(ChatEvent(event="StreamSubscribed", content=body.chatId))
    try:
        while True:
            event = await queue.get()
            if event is None:
                break
            channel.send_model(ChatEvent(**event))
    except asyncio.CancelledError:
        pass
    finally:
        await broadcaster.unsubscribe(body.chatId, queue)


@command
async def clear_stream_record(body: ClearStreamRequest) -> dict:
    await broadcaster.clear_stream_record(body.chatId)
    return {"success": True}
