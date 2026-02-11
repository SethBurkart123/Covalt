from __future__ import annotations

import asyncio
import copy
import json
import logging
import traceback
import types
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Awaitable, Callable, Optional

from agno.agent import Agent, Message, RunEvent
from agno.media import Audio, File, Image, Video
from agno.run.agent import BaseAgentRunEvent
from agno.run.team import BaseTeamRunEvent, TeamRunEvent
from agno.team import Team
from nodes._types import DataValue, ExecutionResult, NodeEvent
from zynk import Channel

from .. import db
from ..models.chat import Attachment, ChatEvent, ChatMessage
from .agent_manager import get_agent_manager
from . import run_control
from . import stream_broadcaster as broadcaster
from .flow_executor import run_flow
from .tool_registry import get_tool_registry
from .toolset_executor import get_toolset_executor
from .workspace_manager import get_workspace_manager

FlowStreamHandler = Callable[..., Awaitable[None]]
ContentMessageConverter = Callable[[ChatMessage, Optional[str]], list[Any]]

logger = logging.getLogger(__name__)
registry = get_tool_registry()

_TEAM_TO_RUN_EVENT: dict[TeamRunEvent, RunEvent] = {
    getattr(TeamRunEvent, event.name): event
    for event in RunEvent
    if hasattr(TeamRunEvent, event.name)
}

DELEGATION_TOOL_NAMES = {"delegate_task_to_member", "delegate_task_to_members"}

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


def _normalize_event(event: RunEvent | TeamRunEvent | str) -> RunEvent | None:
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


class FlowRunHandle:
    """Run-control bridge for graph runtime flows.

    The cancel endpoint expects an object with cancel_run(run_id). The graph runtime
    path does not have a single long-lived Agent/Team at adapter level, so this
    handle binds to whichever runnable is active in the agent node and proxies
    cancellation calls.
    """

    def __init__(self) -> None:
        self._agent: Any = None
        self._run_id: str | None = None
        self._cancel_requested = False

    def _apply_cancel_if_ready(self) -> None:
        if not self._cancel_requested or self._agent is None or not self._run_id:
            return

        try:
            self._agent.cancel_run(self._run_id)
        except Exception:
            logger.exception("[flow_stream] Failed to cancel bound agent run")

    def bind_agent(self, agent: Any) -> None:
        self._agent = agent
        self._apply_cancel_if_ready()

    def set_run_id(self, run_id: str) -> None:
        if run_id:
            self._run_id = run_id
        self._apply_cancel_if_ready()

    def request_cancel(self) -> None:
        self._cancel_requested = True
        self._apply_cancel_if_ready()

    def cancel_run(self, run_id: str) -> None:
        self._run_id = run_id
        self.request_cancel()

    def is_cancel_requested(self) -> bool:
        return self._cancel_requested


def parse_model_id(model_id: Optional[str]) -> tuple[str, str]:
    if not model_id:
        return "", ""
    if ":" in model_id:
        provider, model = model_id.split(":", 1)
        return provider, model
    return "", model_id


def update_chat_model_selection(sess: Any, chat_id: str, model_id: str) -> None:
    config = db.get_chat_agent_config(sess, chat_id) or {}
    if model_id.startswith("agent:"):
        config["agent_id"] = model_id[len("agent:") :]
    else:
        provider, model = parse_model_id(model_id)
        config["provider"] = provider
        config["model_id"] = model
        config.pop("agent_id", None)
    db.update_chat_agent_config(sess, chatId=chat_id, config=config)


def _normalize_instruction_list(raw_instructions: Any) -> list[str]:
    if isinstance(raw_instructions, str):
        stripped = raw_instructions.strip()
        return [stripped] if stripped else []

    if not isinstance(raw_instructions, list):
        return []

    values: list[str] = []
    for item in raw_instructions:
        if not isinstance(item, str):
            continue
        stripped = item.strip()
        if stripped:
            values.append(stripped)
    return values


def _resolve_model_ref(provider: str, model_id: str) -> str:
    provider_clean = provider.strip()
    model_clean = model_id.strip()

    if not model_clean:
        raise ValueError("Model selection is not configured")

    if not provider_clean and ":" in model_clean:
        provider_clean, model_clean = model_clean.split(":", 1)

    if not provider_clean:
        raise ValueError("Model provider is not configured")

    return f"{provider_clean}:{model_clean}"


def _build_canonical_chat_graph(
    *,
    provider: str,
    model_id: str,
    system_prompt: str,
    instructions: list[str],
    name: str,
    description: str,
) -> dict[str, Any]:
    model_ref = _resolve_model_ref(provider, model_id)

    prompt_sections = [
        section for section in [system_prompt.strip(), *instructions] if section
    ]
    agent_data: dict[str, Any] = {
        "name": name,
        "description": description,
        "model": model_ref,
    }
    if prompt_sections:
        agent_data["instructions"] = "\n\n".join(prompt_sections)

    return {
        "nodes": [
            {
                "id": "chat-start-1",
                "type": "chat-start",
                "position": {"x": 120.0, "y": 160.0},
                "data": {"includeUserTools": True},
            },
            {
                "id": "agent-1",
                "type": "agent",
                "position": {"x": 420.0, "y": 160.0},
                "data": agent_data,
            },
        ],
        "edges": [
            {
                "id": "e-chat-start-1-agent-1",
                "source": "chat-start-1",
                "sourceHandle": "output",
                "target": "agent-1",
                "targetHandle": "input",
                "data": {
                    "sourceType": "data",
                    "targetType": "data",
                    "channel": "flow",
                },
            }
        ],
    }


def get_graph_data_for_chat(
    chat_id: str,
    model_id: Optional[str],
) -> dict[str, Any]:
    with db.db_session() as sess:
        config = db.get_chat_agent_config(sess, chat_id) or {}
        system_prompt = db.get_system_prompt_setting(sess) or ""

    agent_id: str | None = None

    if model_id:
        if model_id.startswith("agent:"):
            agent_id = model_id[len("agent:") :]
        else:
            provider, parsed_model = parse_model_id(model_id)
            if not provider:
                provider = str(config.get("provider") or "")
            if not parsed_model:
                parsed_model = str(config.get("model_id") or "")
            instructions = _normalize_instruction_list(config.get("instructions"))
            name = str(config.get("name") or "Assistant")
            description = str(
                config.get("description") or "You are a helpful AI assistant."
            )
            return _build_canonical_chat_graph(
                provider=provider,
                model_id=parsed_model,
                system_prompt=system_prompt,
                instructions=instructions,
                name=name,
                description=description,
            )

    if not agent_id and isinstance(config, dict):
        configured_agent = config.get("agent_id")
        if isinstance(configured_agent, str) and configured_agent:
            agent_id = configured_agent

    if agent_id:
        agent_manager = get_agent_manager()
        agent_data = agent_manager.get_agent(agent_id)
        if not agent_data:
            raise ValueError(f"Agent '{agent_id}' not found")
        return agent_data["graph_data"]

    provider = str(config.get("provider") or "")
    configured_model = str(config.get("model_id") or "")
    instructions = _normalize_instruction_list(config.get("instructions"))
    name = str(config.get("name") or "Assistant")
    description = str(config.get("description") or "You are a helpful AI assistant.")

    return _build_canonical_chat_graph(
        provider=provider,
        model_id=configured_model,
        system_prompt=system_prompt,
        instructions=instructions,
        name=name,
        description=description,
    )


def _require_user_message(messages: list[ChatMessage]) -> None:
    if not messages or messages[-1].role != "user":
        raise ValueError("No user message found in request")


def _serialize_content_for_runtime(content: Any) -> Any:
    if not isinstance(content, list):
        return content

    serialized: list[Any] = []
    for block in content:
        if hasattr(block, "model_dump"):
            serialized.append(block.model_dump())
            continue
        if isinstance(block, dict):
            serialized.append(dict(block))
            continue
        serialized.append({"type": "text", "content": str(block)})
    return serialized


def _serialize_attachments_for_runtime(attachments: Any) -> list[dict[str, Any]]:
    if not attachments:
        return []

    serialized: list[dict[str, Any]] = []
    for attachment in attachments:
        if hasattr(attachment, "model_dump"):
            payload = attachment.model_dump()
            if isinstance(payload, dict):
                serialized.append(payload)
            continue
        if isinstance(attachment, dict):
            serialized.append(dict(attachment))
            continue

        serialized.append(
            {
                "id": str(getattr(attachment, "id", "")),
                "type": str(getattr(attachment, "type", "file")),
                "name": str(getattr(attachment, "name", "")),
                "mimeType": str(getattr(attachment, "mimeType", "")),
                "size": int(getattr(attachment, "size", 0) or 0),
            }
        )
    return serialized


def build_chat_runtime_history(messages: list[ChatMessage]) -> list[dict[str, Any]]:
    history: list[dict[str, Any]] = []
    for message in messages:
        history.append(
            {
                "id": message.id,
                "role": message.role,
                "content": _serialize_content_for_runtime(message.content),
                "createdAt": message.createdAt,
                "attachments": _serialize_attachments_for_runtime(message.attachments),
            }
        )
    return history


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
    chat_id: str, attachments: list[Attachment]
) -> tuple[list[Image], list[File], list[Audio], list[Video]]:
    images: list[Image] = []
    files: list[File] = []
    audio: list[Audio] = []
    videos: list[Video] = []

    workspace_manager = get_workspace_manager(chat_id)

    for attachment in attachments:
        if attachment.size > MAX_ATTACHMENT_BYTES:
            logger.warning(
                f"[attachments] Skipping {attachment.id} ({attachment.name}): {attachment.size} bytes exceeds {MAX_ATTACHMENT_BYTES}"
            )
            continue

        if not is_allowed_attachment_mime(attachment.mimeType):
            logger.warning(
                f"[attachments] Skipping {attachment.id} ({attachment.name}): MIME '{attachment.mimeType}' not allowed for Agno"
            )
            continue

        filepath = workspace_manager.workspace_dir / attachment.name
        if not filepath.exists():
            logger.warning(
                f"[attachments] Skipping {attachment.id} ({attachment.name}): file not found in workspace"
            )
            continue

        if attachment.type == "image":
            images.append(Image(filepath=filepath))
        elif attachment.type == "audio":
            audio.append(Audio(filepath=filepath))
        elif attachment.type == "video":
            videos.append(Video(filepath=filepath))
        else:
            files.append(File(filepath=filepath, name=attachment.name))

    return images, files, audio, videos


def convert_chat_message_to_agno_messages(
    chat_msg: ChatMessage,
    chat_id: str | None = None,
) -> list[Message]:
    if chat_msg.role == "user":
        content = chat_msg.content
        if isinstance(content, list):
            content = json.dumps(content)

        images_list: list[Image] | None = None
        files_list: list[File] | None = None
        audio_list: list[Audio] | None = None
        videos_list: list[Video] | None = None

        if chat_id and chat_msg.attachments:
            images, files, audio, videos = load_attachments_as_agno_media(
                chat_id, chat_msg.attachments
            )
            if images:
                images_list = images
            if files:
                files_list = files
            if audio:
                audio_list = audio
            if videos:
                videos_list = videos

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

        normalized_content = _serialize_content_for_runtime(content)
        if not isinstance(normalized_content, list):
            return [Message(role="assistant", content=str(normalized_content))]

        messages: list[Message] = []
        text_parts: list[str] = []

        for block in normalized_content:
            if not isinstance(block, dict):
                continue

            block_type = block.get("type")

            if block_type == "text":
                block_content = block.get("content")
                text_parts.append(str(block_content or ""))
                continue

            if block_type == "tool_call":
                block_id = block.get("id")
                tool_name = block.get("toolName")
                tool_args = block.get("toolArgs")
                tool_result = block.get("toolResult")

                message_content = " ".join(text_parts) if text_parts else None
                messages.append(
                    Message(
                        role="assistant",
                        content=message_content,
                        tool_calls=[
                            {
                                "id": block_id,
                                "type": "function",
                                "function": {
                                    "name": tool_name,
                                    "arguments": json.dumps(tool_args or {}),
                                },
                            }
                        ],
                    )
                )
                text_parts = []

                if tool_result:
                    messages.append(
                        Message(
                            role="tool",
                            tool_call_id=block_id,
                            content=str(tool_result),
                        )
                    )

        if text_parts:
            messages.append(Message(role="assistant", content=" ".join(text_parts)))

        return messages if messages else [Message(role="assistant", content="")]

    return []


def build_agno_messages_for_chat(
    messages: list[ChatMessage],
    chat_id: str | None,
) -> list[Message]:
    agno_messages: list[Message] = []
    for message in messages:
        agno_messages.extend(convert_chat_message_to_agno_messages(message, chat_id))
    return agno_messages


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
        self._pending_broadcasts: list[asyncio.Task[Any]] = []

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


def save_msg_content(msg_id: str, content: str) -> None:
    with db.db_session() as sess:
        db.update_message_content(sess, messageId=msg_id, content=content)


def load_initial_content(msg_id: str) -> list[dict[str, Any]]:
    try:
        with db.db_session() as sess:
            message = sess.get(db.Message, msg_id)
            if not message or not message.content:
                return []

            return parse_message_blocks(
                message.content,
                strip_trailing_errors=True,
            )
    except Exception as e:
        logger.info(f"[flow_stream] Warning loading initial content: {e}")
        return []


def parse_message_blocks(
    content: str,
    *,
    strip_trailing_errors: bool = False,
) -> list[dict[str, Any]]:
    raw = content.strip()
    if not raw:
        return []

    blocks: list[dict[str, Any]]
    try:
        if raw.startswith("["):
            parsed = json.loads(raw)
            blocks = parsed if isinstance(parsed, list) else []
        else:
            blocks = [{"type": "text", "content": content}]
    except Exception:
        blocks = [{"type": "text", "content": content}]

    normalized: list[dict[str, Any]] = []
    for block in blocks:
        if isinstance(block, dict):
            normalized.append(block)
        else:
            normalized.append({"type": "text", "content": str(block)})

    if strip_trailing_errors:
        while normalized and normalized[-1].get("type") == "error":
            normalized.pop()

    return normalized


def append_error_block_to_message(
    message_id: str,
    *,
    error_message: str,
    traceback_text: str | None = None,
) -> None:
    error_block: dict[str, Any] = {
        "type": "error",
        "content": error_message,
        "timestamp": datetime.now(UTC).isoformat(),
    }
    if traceback_text:
        error_block["traceback"] = traceback_text

    with db.db_session() as sess:
        message = sess.get(db.Message, message_id)
        blocks = (
            parse_message_blocks(message.content)
            if message and isinstance(message.content, str)
            else []
        )
        blocks.append(error_block)
        db.update_message_content(
            sess, messageId=message_id, content=json.dumps(blocks)
        )


def _pick_text_output(outputs: dict[str, DataValue]) -> DataValue | None:
    if not outputs:
        return None

    data_output = outputs.get("output") or outputs.get("true") or outputs.get("false")
    if data_output is None:
        for value in outputs.values():
            if value.type == "string":
                return value
        return next(iter(outputs.values()))

    raw_value = data_output.value
    if isinstance(raw_value, dict):
        for key in ("response", "text", "message"):
            if key in raw_value and raw_value.get(key) is not None:
                return DataValue(type="string", value=str(raw_value.get(key)))
        return DataValue(type="string", value=str(raw_value))

    return DataValue(type="string", value="" if raw_value is None else str(raw_value))


def _chat_event_from_agent_runtime_event(data: dict[str, Any]) -> ChatEvent | None:
    event_name = str(data.get("event") or "")
    if not event_name:
        return None

    payload: dict[str, Any] = {"event": event_name}

    if "content" in data:
        payload["content"] = data.get("content")
    if "reasoningContent" in data:
        payload["reasoningContent"] = data.get("reasoningContent")
    if "tool" in data:
        payload["tool"] = data.get("tool")
    if "memberRunId" in data:
        payload["memberRunId"] = data.get("memberRunId")
    if "memberName" in data:
        payload["memberName"] = data.get("memberName")
    if "task" in data:
        payload["task"] = data.get("task")

    return ChatEvent(**payload)


async def handle_flow_stream(
    graph_data: dict[str, Any],
    agent: Any,
    messages: list[ChatMessage],
    assistant_msg_id: str,
    raw_ch: Any,
    chat_id: str = "",
    ephemeral: bool = False,
    extra_tool_ids: list[str] | None = None,
    run_flow_impl: Callable[..., Any] | None = None,
    save_content_impl: Callable[[str, str], None] | None = None,
    load_initial_content_impl: Callable[[str], list[dict[str, Any]]] | None = None,
) -> None:
    """Run flow runtime and forward NodeEvents as chat protocol events."""
    ch = BroadcastingChannel(raw_ch, chat_id) if chat_id else raw_ch

    def _noop_save(msg_id: str, content: str) -> None:
        del msg_id, content

    save_content_fn = save_content_impl or save_msg_content
    load_initial_fn = load_initial_content_impl or load_initial_content
    save_content = save_content_fn if not ephemeral else _noop_save

    run_handle = FlowRunHandle()
    run_control.register_active_run(assistant_msg_id, run_handle)

    if chat_id:
        await broadcaster.register_stream(chat_id, assistant_msg_id)

    if run_control.consume_early_cancel(assistant_msg_id):
        run_control.remove_active_run(assistant_msg_id)
        ch.send_model(ChatEvent(event="RunCancelled"))
        if chat_id:
            await broadcaster.update_stream_status(chat_id, "completed")
            await broadcaster.unregister_stream(chat_id)
        return

    user_message = ""
    last_user_attachments: list[dict[str, Any]] = []
    if messages and messages[-1].role == "user":
        last_user_message = messages[-1]
        content = last_user_message.content
        user_message = content if isinstance(content, str) else json.dumps(content)
        last_user_attachments = _serialize_attachments_for_runtime(
            last_user_message.attachments
        )

    chat_history = build_chat_runtime_history(messages)
    agno_messages = build_agno_messages_for_chat(messages, chat_id or None)

    state = types.SimpleNamespace(user_message=user_message)
    context = types.SimpleNamespace(
        run_id=str(uuid.uuid4()),
        chat_id=chat_id,
        state=state,
        services=types.SimpleNamespace(
            run_handle=run_handle,
            extra_tool_ids=list(extra_tool_ids or []),
            tool_registry=registry,
            chat_input=types.SimpleNamespace(
                last_user_message=user_message,
                last_user_attachments=last_user_attachments,
                history=chat_history,
                agno_messages=agno_messages,
            ),
        ),
    )

    content_blocks: list[dict[str, Any]] = (
        [] if ephemeral else load_initial_fn(assistant_msg_id)
    )
    current_text = ""
    final_output: DataValue | None = None
    runtime_run_flow = run_flow_impl or run_flow
    had_error = False
    was_cancelled = False
    terminal_event: str | None = None

    def _flush_current_text() -> None:
        nonlocal current_text
        if not current_text:
            return
        content_blocks.append({"type": "text", "content": current_text})
        current_text = ""

    try:
        async for item in runtime_run_flow(graph_data, context):
            if isinstance(item, NodeEvent):
                if item.event_type == "started":
                    ch.send_model(
                        ChatEvent(
                            event="FlowNodeStarted",
                            content=json.dumps(
                                {"nodeId": item.node_id, "nodeType": item.node_type}
                            ),
                        )
                    )
                elif item.event_type == "progress":
                    token = (item.data or {}).get("token", "")
                    if token:
                        current_text += token
                        ch.send_model(ChatEvent(event="RunContent", content=token))
                        await asyncio.to_thread(
                            save_content,
                            assistant_msg_id,
                            json.dumps(
                                content_blocks
                                + (
                                    [{"type": "text", "content": current_text}]
                                    if current_text
                                    else []
                                )
                            ),
                        )
                elif item.event_type == "agent_run_id":
                    run_id = str((item.data or {}).get("run_id") or "")
                    if run_id:
                        run_control.set_active_run_id(assistant_msg_id, run_id)
                        if chat_id:
                            await broadcaster.update_stream_run_id(chat_id, run_id)
                elif item.event_type == "agent_event":
                    chat_event = _chat_event_from_agent_runtime_event(item.data or {})
                    if chat_event is not None:
                        ch.send_model(chat_event)

                    event_name = str((item.data or {}).get("event") or "")
                    if event_name == "ToolApprovalRequired" and chat_id:
                        await broadcaster.update_stream_status(chat_id, "paused_hitl")
                    elif event_name == "ToolApprovalResolved" and chat_id:
                        await broadcaster.update_stream_status(chat_id, "streaming")
                elif item.event_type == "cancelled":
                    was_cancelled = True
                    terminal_event = "RunCancelled"
                    _flush_current_text()
                    await asyncio.to_thread(
                        save_content,
                        assistant_msg_id,
                        json.dumps(content_blocks),
                    )
                    ch.send_model(ChatEvent(event="RunCancelled"))
                    if chat_id:
                        await broadcaster.update_stream_status(chat_id, "completed")
                        await broadcaster.unregister_stream(chat_id)
                    return
                elif item.event_type == "completed":
                    ch.send_model(
                        ChatEvent(
                            event="FlowNodeCompleted",
                            content=json.dumps(
                                {"nodeId": item.node_id, "nodeType": item.node_type}
                            ),
                        )
                    )
                elif item.event_type == "error":
                    error_msg = (item.data or {}).get("error", "Unknown node error")
                    error_text = f"[{item.node_type}] {error_msg}"
                    _flush_current_text()
                    content_blocks.append(
                        {
                            "type": "error",
                            "content": error_text,
                            "timestamp": datetime.now(UTC).isoformat(),
                        }
                    )
                    ch.send_model(ChatEvent(event="RunError", content=error_text))
                    await asyncio.to_thread(
                        save_content, assistant_msg_id, json.dumps(content_blocks)
                    )
                    had_error = True
                    terminal_event = "RunError"
                    if chat_id:
                        await broadcaster.update_stream_status(
                            chat_id, "error", error_text
                        )
                        await broadcaster.unregister_stream(chat_id)
                    return
            elif isinstance(item, ExecutionResult):
                final_output = _pick_text_output(item.outputs)

        if terminal_event is not None:
            return

        _flush_current_text()

        if final_output is not None and not any(
            block.get("type") == "text" for block in content_blocks
        ):
            final_value = final_output.value
            text = str(final_value) if final_value is not None else ""
            if text:
                content_blocks.append({"type": "text", "content": text})
                ch.send_model(ChatEvent(event="RunContent", content=text))

        await asyncio.to_thread(
            save_content, assistant_msg_id, json.dumps(content_blocks)
        )

        if not ephemeral:
            with db.db_session() as sess:
                db.mark_message_complete(sess, assistant_msg_id)

        terminal_event = "RunCompleted"
        ch.send_model(ChatEvent(event="RunCompleted"))

        if hasattr(ch, "flush_broadcasts"):
            await ch.flush_broadcasts()

        if chat_id:
            await broadcaster.update_stream_status(chat_id, "completed")
            await broadcaster.unregister_stream(chat_id)
    except Exception as e:
        logger.error(f"[flow_stream] Exception: {e}")
        traceback.print_exc()

        if terminal_event is not None:
            return

        _flush_current_text()

        error_msg = extract_error_message(str(e))
        content_blocks.append(
            {
                "type": "error",
                "content": error_msg,
                "timestamp": datetime.now(UTC).isoformat(),
            }
        )
        await asyncio.to_thread(
            save_content, assistant_msg_id, json.dumps(content_blocks)
        )
        ch.send_model(ChatEvent(event="RunError", content=error_msg))
        had_error = True
        terminal_event = "RunError"

        if chat_id:
            await broadcaster.update_stream_status(chat_id, "error", str(e))
            await broadcaster.unregister_stream(chat_id)
    finally:
        run_control.remove_active_run(assistant_msg_id)
        run_control.clear_early_cancel(assistant_msg_id)

        if not had_error and not was_cancelled and not ephemeral:
            with db.db_session() as sess:
                message = sess.get(db.Message, assistant_msg_id)
                if message and not message.is_complete:
                    db.mark_message_complete(sess, assistant_msg_id)


async def handle_content_stream(
    agent: Agent | Team,
    messages: list[ChatMessage],
    assistant_msg_id: str,
    raw_ch: Any,
    chat_id: str = "",
    ephemeral: bool = False,
    *,
    convert_message: ContentMessageConverter | None = None,
    save_content_impl: Callable[[str, str], None] | None = None,
    load_initial_content_impl: Callable[[str], list[dict[str, Any]]] | None = None,
) -> None:
    if convert_message is None:
        raise ValueError("convert_message callback is required")

    ch = BroadcastingChannel(raw_ch, chat_id) if chat_id else raw_ch

    def _noop_save(msg_id: str, content: str) -> None:
        del msg_id, content

    save_content_fn = save_content_impl or save_msg_content
    load_initial_fn = load_initial_content_impl or load_initial_content
    save_content = save_content_fn if not ephemeral else _noop_save

    agno_messages: list[Any] = []
    for msg in messages:
        agno_messages.extend(convert_message(msg, chat_id))

    if chat_id:
        await broadcaster.register_stream(chat_id, assistant_msg_id)

    run_control.register_active_run(assistant_msg_id, agent)

    response_stream = agent.arun(
        input=agno_messages,
        add_history_to_context=True,
        stream=True,
        stream_events=True,
    )

    if run_control.consume_early_cancel(assistant_msg_id):
        run_control.remove_active_run(assistant_msg_id)
        ch.send_model(ChatEvent(event="RunCancelled"))
        if chat_id:
            await broadcaster.update_stream_status(chat_id, "completed")
            await broadcaster.unregister_stream(chat_id)
        return

    content_blocks = [] if ephemeral else load_initial_fn(assistant_msg_id)
    current_text = ""
    current_reasoning = ""
    had_error = False
    run_id: str | None = None

    active_delegation_tool_id: str | None = None
    delegation_task: str = ""
    member_runs: dict[str, MemberRunState] = {}

    def _get_member_run(chunk: Any) -> MemberRunState:
        rid = str(getattr(chunk, "run_id", "") or "")
        if rid in member_runs:
            member_state = member_runs[rid]
            name = getattr(chunk, "agent_name", "") or ""
            if name:
                member_state.name = name
                content_blocks[member_state.block_index]["memberName"] = name
            return member_state

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
        block_index = len(content_blocks) - 1
        member_state = MemberRunState(run_id=rid, name=name, block_index=block_index)
        member_runs[rid] = member_state
        ch.send_model(
            ChatEvent(
                event="MemberRunStarted",
                memberName=name,
                memberRunId=rid,
                task=delegation_task,
            )
        )
        return member_state

    async def _handle_member_event(evt: RunEvent, chunk: Any) -> None:
        member_state = _get_member_run(chunk)
        member_content = content_blocks[member_state.block_index]["content"]
        rid = member_state.run_id
        name = member_state.name

        def _make_event(**kwargs: Any) -> ChatEvent:
            return ChatEvent(memberRunId=rid, memberName=name, **kwargs)

        if evt == RunEvent.run_content:
            if getattr(chunk, "reasoning_content", None):
                text = chunk.reasoning_content
                if member_state.current_text and not member_state.current_reasoning:
                    member_content.append(
                        {"type": "text", "content": member_state.current_text}
                    )
                    member_state.current_text = ""
                member_state.current_reasoning += text
                ch.send_model(_make_event(event="ReasoningStep", reasoningContent=text))

            if chunk.content:
                text = chunk.content
                if member_state.current_reasoning and not member_state.current_text:
                    member_content.append(
                        {
                            "type": "reasoning",
                            "content": member_state.current_reasoning,
                            "isCompleted": True,
                        }
                    )
                    member_state.current_reasoning = ""
                member_state.current_text += text
                ch.send_model(_make_event(event="RunContent", content=text))

            await asyncio.to_thread(save_content, assistant_msg_id, save_state())

        elif evt == RunEvent.reasoning_started:
            if member_state.current_text:
                member_content.append(
                    {"type": "text", "content": member_state.current_text}
                )
                member_state.current_text = ""
            ch.send_model(_make_event(event="ReasoningStarted"))

        elif evt in (RunEvent.reasoning_step, RunEvent.reasoning_content_delta):
            text = getattr(chunk, "reasoning_content", "") or ""
            if text:
                if member_state.current_text:
                    member_content.append(
                        {"type": "text", "content": member_state.current_text}
                    )
                    member_state.current_text = ""
                member_state.current_reasoning += text
                ch.send_model(_make_event(event="ReasoningStep", reasoningContent=text))
                await asyncio.to_thread(save_content, assistant_msg_id, save_state())

        elif evt == RunEvent.reasoning_completed:
            if member_state.current_reasoning:
                member_content.append(
                    {
                        "type": "reasoning",
                        "content": member_state.current_reasoning,
                        "isCompleted": True,
                    }
                )
                member_state.current_reasoning = ""
            ch.send_model(_make_event(event="ReasoningCompleted"))
            await asyncio.to_thread(save_content, assistant_msg_id, save_state())

        elif evt == RunEvent.tool_call_started:
            if member_state.current_text:
                member_content.append(
                    {"type": "text", "content": member_state.current_text}
                )
                member_state.current_text = ""
            if member_state.current_reasoning:
                member_content.append(
                    {
                        "type": "reasoning",
                        "content": member_state.current_reasoning,
                        "isCompleted": True,
                    }
                )
                member_state.current_reasoning = ""
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
            await asyncio.to_thread(save_content, assistant_msg_id, save_state())

        elif evt == RunEvent.run_error:
            if member_state.current_text:
                member_content.append(
                    {"type": "text", "content": member_state.current_text}
                )
                member_state.current_text = ""
            if member_state.current_reasoning:
                member_content.append(
                    {
                        "type": "reasoning",
                        "content": member_state.current_reasoning,
                        "isCompleted": True,
                    }
                )
                member_state.current_reasoning = ""

            error_msg = extract_error_message(
                chunk.content if chunk.content else str(chunk)
            )
            member_content.append({"type": "error", "content": error_msg})
            content_blocks[member_state.block_index]["isCompleted"] = True
            content_blocks[member_state.block_index]["hasError"] = True

            ch.send_model(_make_event(event="MemberRunError", content=error_msg))
            member_runs.pop(rid, None)
            await asyncio.to_thread(save_content, assistant_msg_id, save_state())

        elif evt == RunEvent.run_completed:
            return

    def _flush_all_member_runs() -> None:
        for member_state in member_runs.values():
            member_content = content_blocks[member_state.block_index]["content"]
            if member_state.current_text:
                member_content.append(
                    {"type": "text", "content": member_state.current_text}
                )
                member_state.current_text = ""
            if member_state.current_reasoning:
                member_content.append(
                    {
                        "type": "reasoning",
                        "content": member_state.current_reasoning,
                        "isCompleted": True,
                    }
                )
                member_state.current_reasoning = ""
            content_blocks[member_state.block_index]["isCompleted"] = True
            ch.send_model(
                ChatEvent(
                    event="MemberRunCompleted",
                    memberName=member_state.name,
                    memberRunId=member_state.run_id,
                )
            )
        member_runs.clear()

    def flush_text() -> None:
        nonlocal current_text
        if current_text:
            content_blocks.append({"type": "text", "content": current_text})
            current_text = ""

    def flush_reasoning() -> None:
        nonlocal current_reasoning
        if current_reasoning:
            content_blocks.append(
                {"type": "reasoning", "content": current_reasoning, "isCompleted": True}
            )
            current_reasoning = ""

    def save_state() -> str:
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
        for member_state in member_runs.values():
            if (
                member_state.block_index < len(temp)
                and temp[member_state.block_index].get("type") == "member_run"
            ):
                member_content = temp[member_state.block_index]["content"]
                if member_state.current_text:
                    member_content.append(
                        {"type": "text", "content": member_state.current_text}
                    )
                if member_state.current_reasoning:
                    member_content.append(
                        {
                            "type": "reasoning",
                            "content": member_state.current_reasoning,
                            "isCompleted": False,
                        }
                    )
        return json.dumps(temp)

    def save_final() -> str:
        return json.dumps(content_blocks)

    try:
        while True:
            async for chunk in response_stream:
                if not run_id and chunk.run_id:
                    run_id = chunk.run_id
                    run_control.set_active_run_id(assistant_msg_id, run_id)
                    logger.info(f"[stream] Captured run_id {run_id}")
                    if chat_id:
                        await broadcaster.update_stream_run_id(chat_id, run_id)

                    if run_control.consume_early_cancel(assistant_msg_id):
                        logger.info(f"[stream] Early cancel detected for {run_id}")
                        agent.cancel_run(run_id)

                evt = _normalize_event(chunk.event)
                if evt is None:
                    continue

                if active_delegation_tool_id and _is_member_event(chunk):
                    await _handle_member_event(evt, chunk)
                    continue

                if evt == RunEvent.run_cancelled:
                    flush_text()
                    flush_reasoning()
                    await asyncio.to_thread(
                        save_content, assistant_msg_id, save_final()
                    )
                    if not ephemeral:
                        with db.db_session() as sess:
                            db.mark_message_complete(sess, assistant_msg_id)
                    run_control.remove_active_run(assistant_msg_id)
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
                        await asyncio.to_thread(
                            save_content, assistant_msg_id, save_state()
                        )

                    if chunk.content:
                        if current_reasoning and not current_text:
                            flush_reasoning()
                        current_text += chunk.content
                        ch.send_model(
                            ChatEvent(event="RunContent", content=chunk.content)
                        )
                        await asyncio.to_thread(
                            save_content, assistant_msg_id, save_state()
                        )

                elif evt == RunEvent.tool_call_started:
                    if _is_team_event(chunk) and _is_delegation_tool(
                        chunk.tool.tool_name
                    ):
                        flush_text()
                        flush_reasoning()
                        active_delegation_tool_id = chunk.tool.tool_call_id
                        delegation_task = (chunk.tool.tool_args or {}).get("task", "")
                        content_blocks.append(
                            {
                                "type": "tool_call",
                                "id": chunk.tool.tool_call_id,
                                "toolName": chunk.tool.tool_name,
                                "toolArgs": chunk.tool.tool_args,
                                "isCompleted": False,
                                "isDelegation": True,
                            }
                        )
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
                        tool_result = (
                            str(chunk.tool.result)
                            if chunk.tool.result is not None
                            else None
                        )
                        for block in content_blocks:
                            if (
                                block.get("type") == "tool_call"
                                and block.get("id") == active_delegation_tool_id
                            ):
                                block["isCompleted"] = True
                                block["toolResult"] = tool_result
                                break
                        active_delegation_tool_id = None
                        delegation_task = ""
                        await asyncio.to_thread(
                            save_content, assistant_msg_id, save_final()
                        )
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
                            index
                            for index, block in enumerate(content_blocks)
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
                        save_content, assistant_msg_id, save_final()
                    )

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
                        await asyncio.to_thread(
                            save_content, assistant_msg_id, save_state()
                        )

                elif evt == RunEvent.reasoning_completed:
                    flush_reasoning()
                    ch.send_model(ChatEvent(event="ReasoningCompleted"))

                elif evt == RunEvent.run_completed:
                    flush_text()
                    flush_reasoning()
                    await asyncio.to_thread(
                        save_content, assistant_msg_id, save_final()
                    )
                    if not ephemeral:
                        with db.db_session() as sess:
                            db.mark_message_complete(sess, assistant_msg_id)
                    ch.send_model(ChatEvent(event="RunCompleted"))
                    if hasattr(ch, "flush_broadcasts"):
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
                            "timestamp": datetime.now(UTC).isoformat(),
                        }
                    )
                    await asyncio.to_thread(
                        save_content, assistant_msg_id, save_final()
                    )
                    ch.send_model(ChatEvent(event="RunError", content=error_msg))
                    had_error = True
                    if hasattr(ch, "flush_broadcasts"):
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

                        await asyncio.to_thread(
                            save_content, assistant_msg_id, save_state()
                        )
                        ch.send_model(
                            ChatEvent(
                                event="ToolApprovalRequired",
                                tool={"runId": run_id, "tools": tools_info},
                            )
                        )

                        approval_event = asyncio.Event()
                        run_control.register_approval_waiter(run_id, approval_event)

                        timed_out = False
                        try:
                            await asyncio.wait_for(approval_event.wait(), timeout=300)
                        except asyncio.TimeoutError:
                            timed_out = True
                            for tool in chunk.tools_requiring_confirmation:
                                tool.confirmed = False
                        else:
                            response = run_control.get_approval_response(run_id)
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

                        run_control.clear_approval(run_id)

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

                        await asyncio.to_thread(
                            save_content, assistant_msg_id, save_state()
                        )

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
            run_control.clear_approval(run_id)
        raise
    except Exception as e:
        logger.error(f"[stream] Exception in stream handler: {e}")
        flush_text()
        flush_reasoning()
        error_msg = extract_error_message(str(e))
        content_blocks.append(
            {
                "type": "error",
                "content": error_msg,
                "timestamp": datetime.now(UTC).isoformat(),
            }
        )
        had_error = True
        try:
            await asyncio.to_thread(save_content, assistant_msg_id, save_final())
        except Exception as save_err:
            logger.error(f"[stream] Failed to save state on error: {save_err}")
        ch.send_model(ChatEvent(event="RunError", content=error_msg))
        if chat_id:
            await broadcaster.update_stream_status(chat_id, "error", str(e))
            await broadcaster.unregister_stream(chat_id)

    run_control.remove_active_run(assistant_msg_id)
    run_control.clear_early_cancel(assistant_msg_id)

    if not had_error and not ephemeral:
        with db.db_session() as sess:
            message = sess.get(db.Message, assistant_msg_id)
            if message and not message.is_complete:
                db.mark_message_complete(sess, assistant_msg_id)
        if chat_id:
            await broadcaster.update_stream_status(chat_id, "completed")
            await broadcaster.unregister_stream(chat_id)


async def run_graph_chat_runtime(
    graph_data: dict[str, Any],
    messages: list[ChatMessage],
    assistant_msg_id: str,
    channel: Channel,
    *,
    chat_id: str,
    ephemeral: bool,
    extra_tool_ids: list[str] | None = None,
    flow_stream_handler: FlowStreamHandler | None = None,
) -> None:
    _require_user_message(messages)

    handler = flow_stream_handler or handle_flow_stream

    await handler(
        graph_data,
        None,
        messages,
        assistant_msg_id,
        channel,
        chat_id=chat_id,
        ephemeral=ephemeral,
        extra_tool_ids=extra_tool_ids,
    )
