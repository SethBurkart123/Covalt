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
from nodes._types import DataValue, ExecutionResult, NodeEvent, RuntimeConfigContext
from nodes import get_executor
from zynk import Channel

from .. import db
from ..models.chat import Attachment, ChatEvent, ChatMessage, ToolCall
from .agent_manager import get_agent_manager
from . import run_control
from . import stream_broadcaster as broadcaster
from .flow_executor import run_flow
from .execution_trace import ExecutionTraceRecorder
from .tool_registry import get_tool_registry
from .mcp_manager import ensure_mcp_initialized
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

FLOW_EDGE_CHANNEL = "flow"


def _log_token_usage(
    *,
    run_id: str | None,
    model: str | None,
    provider: str | None,
    input_tokens: int | None,
    output_tokens: int | None,
    total_tokens: int | None,
    cache_read_tokens: int | None,
    cache_write_tokens: int | None,
    reasoning_tokens: int | None,
    time_to_first_token: float | None,
) -> None:
    if (
        input_tokens is None
        and output_tokens is None
        and total_tokens is None
        and cache_read_tokens is None
        and cache_write_tokens is None
        and reasoning_tokens is None
    ):
        return

    tokens = {
        "input": input_tokens,
        "output": output_tokens,
        "total": total_tokens,
        "cache_read": cache_read_tokens,
        "cache_write": cache_write_tokens,
        "reasoning": reasoning_tokens,
    }
    tokens_str = ", ".join(
        f"{key}={value}" for key, value in tokens.items() if value is not None
    )
    ttf_str = f" ttf={time_to_first_token:.3f}s" if time_to_first_token else ""
    logger.info(
        "[usage] run_id=%s provider=%s model=%s %s%s",
        run_id or "-",
        provider or "-",
        model or "-",
        tokens_str,
        ttf_str,
    )


def _flow_topology(
    graph_data: dict[str, Any],
) -> tuple[dict[str, dict[str, Any]], dict[str, list[str]], dict[str, list[str]]]:
    nodes_by_id: dict[str, dict[str, Any]] = {}
    for node in graph_data.get("nodes", []):
        if not isinstance(node, dict):
            continue
        node_id = node.get("id")
        if isinstance(node_id, str) and node_id:
            nodes_by_id[node_id] = node

    downstream_by_node: dict[str, list[str]] = {}
    upstream_by_node: dict[str, list[str]] = {}

    for edge in graph_data.get("edges", []):
        if not isinstance(edge, dict):
            continue

        data = edge.get("data")
        if not isinstance(data, dict) or data.get("channel") != FLOW_EDGE_CHANNEL:
            continue

        source_id = edge.get("source")
        target_id = edge.get("target")
        if not isinstance(source_id, str) or not isinstance(target_id, str):
            continue

        downstream_by_node.setdefault(source_id, []).append(target_id)
        upstream_by_node.setdefault(target_id, []).append(source_id)

    return nodes_by_id, downstream_by_node, upstream_by_node


def _chat_entry_node_ids(
    nodes_by_id: dict[str, dict[str, Any]],
    upstream_by_node: dict[str, list[str]],
) -> list[str]:
    chat_start_ids = sorted(
        node_id
        for node_id, node in nodes_by_id.items()
        if node.get("type") == "chat-start"
    )
    if chat_start_ids:
        return chat_start_ids

    root_ids = sorted(
        node_id for node_id in nodes_by_id if not upstream_by_node.get(node_id)
    )
    if root_ids:
        return root_ids

    return sorted(nodes_by_id)


def _build_entry_node_ids(graph_data: dict[str, Any]) -> list[str]:
    nodes_by_id, _downstream_by_node, upstream_by_node = _flow_topology(graph_data)
    return _chat_entry_node_ids(nodes_by_id, upstream_by_node)


def _apply_runtime_config(
    graph_data: dict[str, Any],
    services: Any,
    *,
    mode: str,
) -> None:
    nodes = graph_data.get("nodes", [])
    if not isinstance(nodes, list):
        return

    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_id = node.get("id")
        node_type = node.get("type")
        if not isinstance(node_id, str) or not isinstance(node_type, str):
            continue
        executor = get_executor(node_type)
        if executor is None:
            continue
        configure = getattr(executor, "configure_runtime", None)
        if not callable(configure):
            continue
        try:
            configure(
                node.get("data", {}),
                RuntimeConfigContext(
                    mode=mode,
                    graph_data=graph_data,
                    node_id=node_id,
                    services=services,
                ),
            )
        except Exception:
            logger.exception(
                "[flow_stream] runtime config failed for %s (%s)", node_id, node_type
            )


def _build_trigger_payload(
    user_message: str,
    chat_history: list[dict[str, Any]],
    attachments: list[dict[str, Any]],
    messages: list[Any],
) -> dict[str, Any]:
    return {
        "message": user_message,
        "last_user_message": user_message,
        "history": chat_history,
        "messages": messages,
        "attachments": attachments,
    }


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


def _get_tool_provider_data(tool: Any) -> dict[str, Any] | None:
    if isinstance(tool, dict):
        provider_data = tool.get("providerData")
        return (
            provider_data if isinstance(provider_data, dict) and provider_data else None
        )

    provider_data = getattr(tool, "provider_data", None)
    if isinstance(provider_data, dict) and provider_data:
        return provider_data

    provider_data = getattr(tool, "providerData", None)
    if isinstance(provider_data, dict) and provider_data:
        return provider_data

    return None


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


def _content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") != "text":
                continue
            part = block.get("content")
            if part is not None:
                parts.append(str(part))
        return "".join(parts)
    return str(content) if content is not None else ""


def _tool_call_to_openai(tool_call: ToolCall) -> dict[str, Any]:
    args = tool_call.toolArgs if tool_call.toolArgs is not None else {}
    try:
        arguments = json.dumps(args)
    except TypeError:
        arguments = json.dumps({})
    return {
        "id": tool_call.id,
        "type": "function",
        "function": {
            "name": tool_call.toolName,
            "arguments": arguments,
        },
    }


def build_openai_messages_for_chat(
    messages: list[ChatMessage],
) -> list[dict[str, Any]]:
    formatted: list[dict[str, Any]] = []
    for message in messages:
        content = _content_to_text(message.content)
        payload: dict[str, Any] = {"role": message.role, "content": content}

        tool_calls = message.toolCalls or []
        if message.role == "assistant" and tool_calls:
            payload["tool_calls"] = [
                _tool_call_to_openai(tool_call) for tool_call in tool_calls
            ]

        formatted.append(payload)

        if message.role == "assistant":
            for tool_call in tool_calls:
                if tool_call.toolResult is None:
                    continue
                formatted.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": str(tool_call.toolResult),
                    }
                )

    return formatted


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
                provider_data = block.get("providerData")
                if not isinstance(provider_data, dict) or not provider_data:
                    provider_data = None

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
                                **(
                                    {"providerData": provider_data}
                                    if provider_data
                                    else {}
                                ),
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
        self._broadcast_tail: asyncio.Task[Any] | None = None

    def send_model(self, event: ChatEvent) -> None:
        self._channel.send_model(event)

        if self._chat_id:
            event_dict = (
                event.model_dump() if hasattr(event, "model_dump") else event.dict()
            )
            previous = self._broadcast_tail

            async def _broadcast_in_order() -> None:
                if previous is not None:
                    await previous
                await broadcaster.broadcast_event(self._chat_id, event_dict)

            task = asyncio.create_task(_broadcast_in_order())
            self._broadcast_tail = task
            self._pending_broadcasts.append(task)

    async def flush_broadcasts(self) -> None:
        if self._pending_broadcasts:
            await asyncio.gather(*self._pending_broadcasts, return_exceptions=True)
            self._pending_broadcasts.clear()
            self._broadcast_tail = None


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


def _normalize_tool_node_ref(
    payload: dict[str, Any],
) -> tuple[str, str | None, str | None] | None:
    node_id = payload.get("nodeId")
    if not node_id:
        return None
    node_type = payload.get("nodeType")
    error_value = payload.get("error")
    node_type_text = (
        str(node_type) if isinstance(node_type, str) and node_type else None
    )
    error_text = str(error_value) if error_value is not None else None
    return (str(node_id), node_type_text, error_text)


def _tool_node_refs(tool_payload: Any) -> list[tuple[str, str | None, str | None]]:
    if not isinstance(tool_payload, dict):
        return []

    direct = _normalize_tool_node_ref(tool_payload)
    if direct is not None:
        return [direct]

    tools = tool_payload.get("tools")
    if not isinstance(tools, list):
        return []

    refs: list[tuple[str, str | None, str | None]] = []
    for item in tools:
        if not isinstance(item, dict):
            continue
        ref = _normalize_tool_node_ref(item)
        if ref is not None:
            refs.append(ref)
    return refs


def _count_agent_nodes(graph_data: dict[str, Any]) -> int:
    nodes = graph_data.get("nodes", [])
    if not isinstance(nodes, list):
        return 0
    count = 0
    for node in nodes:
        if isinstance(node, dict) and node.get("type") == "agent":
            count += 1
    return count


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
    if "groupByNode" in data:
        payload["groupByNode"] = data.get("groupByNode")
    if "nodeId" in data:
        payload["nodeId"] = data.get("nodeId")
    if "nodeType" in data:
        payload["nodeType"] = data.get("nodeType")

    return ChatEvent(**payload)


async def handle_flow_stream(
    graph_data: dict[str, Any],
    agent: Any,
    messages: list[ChatMessage],
    assistant_msg_id: str,
    raw_ch: Any,
    chat_id: str = "",
    ephemeral: bool = False,
    agent_id: str | None = None,
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

    trace_recorder = ExecutionTraceRecorder(
        kind="workflow",
        chat_id=chat_id or None,
        message_id=assistant_msg_id,
        enabled=not ephemeral,
    )
    trace_recorder.start()
    trace_status = "streaming"
    trace_error: str | None = None

    run_handle = FlowRunHandle()
    run_control.register_active_run(assistant_msg_id, run_handle)

    if chat_id:
        await broadcaster.register_stream(chat_id, assistant_msg_id)

    if run_control.consume_early_cancel(assistant_msg_id):
        run_control.remove_active_run(assistant_msg_id)
        run_control.clear_early_cancel(assistant_msg_id)
        trace_recorder.record(
            event_type="runtime.run.cancelled", payload={"early": True}
        )
        trace_status = "cancelled"
        trace_recorder.finish(status=trace_status)
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
    openai_messages = build_openai_messages_for_chat(messages)
    entry_node_ids = _build_entry_node_ids(graph_data)
    trigger_payload = _build_trigger_payload(
        user_message,
        chat_history,
        last_user_attachments,
        openai_messages,
    )

    state = types.SimpleNamespace(user_message=user_message)
    services = types.SimpleNamespace(
        run_handle=run_handle,
        extra_tool_ids=list(extra_tool_ids or []),
        tool_registry=registry,
        chat_output=types.SimpleNamespace(primary_agent_id=None),
        chat_input=types.SimpleNamespace(
            last_user_message=user_message,
            last_user_attachments=last_user_attachments,
            history=chat_history,
            messages=openai_messages,
        ),
        expression_context={"trigger": trigger_payload},
        execution=types.SimpleNamespace(entry_node_ids=entry_node_ids),
    )
    _apply_runtime_config(graph_data, services, mode="chat")
    if services is not None:
        chat_output = getattr(services, "chat_output", None)
        if (
            chat_output is not None
            and not getattr(chat_output, "primary_agent_id", None)
            and _count_agent_nodes(graph_data) > 1
        ):
            setattr(chat_output, "group_by_node", True)

    context = types.SimpleNamespace(
        run_id=str(uuid.uuid4()),
        chat_id=chat_id,
        state=state,
        services=services,
    )

    content_blocks: list[dict[str, Any]] = (
        [] if ephemeral else load_initial_fn(assistant_msg_id)
    )
    current_text = ""
    current_reasoning = ""
    member_runs: dict[str, MemberRunState] = {}
    final_output: DataValue | None = None
    primary_output: DataValue | None = None
    primary_agent_id = None
    if services is not None:
        chat_output = getattr(services, "chat_output", None)
        primary_agent_id = getattr(chat_output, "primary_agent_id", None)
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

    def _flush_current_reasoning() -> None:
        nonlocal current_reasoning
        if not current_reasoning:
            return
        content_blocks.append(
            {
                "type": "reasoning",
                "content": current_reasoning,
                "isCompleted": True,
            }
        )
        current_reasoning = ""

    def _find_tool_block(
        blocks: list[dict[str, Any]], tool_id: str
    ) -> dict[str, Any] | None:
        for block in blocks:
            if block.get("type") == "tool_call" and block.get("id") == tool_id:
                return block
        return None

    def _coerce_event_outputs(outputs: Any) -> dict[str, DataValue]:
        if not isinstance(outputs, dict):
            return {}
        coerced: dict[str, DataValue] = {}
        for handle, payload in outputs.items():
            if not isinstance(payload, dict):
                continue
            value_type = payload.get("type")
            if not isinstance(value_type, str) or not value_type:
                continue
            coerced[str(handle)] = DataValue(
                type=value_type, value=payload.get("value")
            )
        return coerced

    def _get_or_create_member_state(data: dict[str, Any]) -> MemberRunState | None:
        run_id = str(data.get("memberRunId") or "")
        if not run_id:
            return None

        name = str(data.get("memberName") or "Agent")
        node_id = data.get("nodeId")
        node_type = data.get("nodeType")
        group_by_node = data.get("groupByNode")
        if run_id in member_runs:
            member_state = member_runs[run_id]
            if name and name != "Agent":
                member_state.name = name
                content_blocks[member_state.block_index]["memberName"] = name
            if node_id:
                content_blocks[member_state.block_index]["nodeId"] = str(node_id)
            if node_type:
                content_blocks[member_state.block_index]["nodeType"] = str(node_type)
            if group_by_node is not None:
                content_blocks[member_state.block_index]["groupByNode"] = bool(
                    group_by_node
                )
            return member_state

        block = {
            "type": "member_run",
            "runId": run_id,
            "memberName": name,
            "content": [],
            "isCompleted": False,
            "task": str(data.get("task") or ""),
        }
        if node_id:
            block["nodeId"] = str(node_id)
        if node_type:
            block["nodeType"] = str(node_type)
        if group_by_node is not None:
            block["groupByNode"] = bool(group_by_node)
        content_blocks.append(block)
        member_state = MemberRunState(
            run_id=run_id,
            name=name,
            block_index=len(content_blocks) - 1,
        )
        member_runs[run_id] = member_state
        return member_state

    def _flush_member_text(member_state: MemberRunState) -> None:
        if not member_state.current_text:
            return
        member_block = content_blocks[member_state.block_index]
        member_block["content"].append(
            {"type": "text", "content": member_state.current_text}
        )
        member_state.current_text = ""

    def _flush_member_reasoning(member_state: MemberRunState) -> None:
        if not member_state.current_reasoning:
            return
        member_block = content_blocks[member_state.block_index]
        member_block["content"].append(
            {
                "type": "reasoning",
                "content": member_state.current_reasoning,
                "isCompleted": True,
            }
        )
        member_state.current_reasoning = ""

    def _flush_all_member_runs() -> None:
        for member_state in list(member_runs.values()):
            _flush_member_text(member_state)
            _flush_member_reasoning(member_state)
            content_blocks[member_state.block_index]["isCompleted"] = True
        member_runs.clear()

    def _serialize_content_state() -> str:
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
            if member_state.block_index >= len(temp):
                continue
            member_block = temp[member_state.block_index]
            if member_block.get("type") != "member_run":
                continue
            member_content = member_block.get("content", [])
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

    def _apply_agent_event_to_content(data: dict[str, Any]) -> bool:
        nonlocal current_text, current_reasoning

        event_name = str(data.get("event") or "")
        if not event_name:
            return False

        member_state = _get_or_create_member_state(data)

        if member_state is not None:
            member_block = content_blocks[member_state.block_index]
            member_content = member_block["content"]

            if event_name == "RunContent":
                text = str(data.get("content") or "")
                if not text:
                    return False
                if member_state.current_reasoning and not member_state.current_text:
                    _flush_member_reasoning(member_state)
                member_state.current_text += text
                return True

            if event_name == "ReasoningStarted":
                _flush_member_text(member_state)
                return True

            if event_name == "ReasoningStep":
                text = str(data.get("reasoningContent") or "")
                if not text:
                    return False
                if member_state.current_text and not member_state.current_reasoning:
                    _flush_member_text(member_state)
                member_state.current_reasoning += text
                return True

            if event_name == "ReasoningCompleted":
                _flush_member_reasoning(member_state)
                return True

            if event_name == "ToolCallStarted":
                tool = data.get("tool") or {}
                tool_id = str(tool.get("id") or "")
                if not tool_id:
                    return False
                provider_data = (
                    tool.get("providerData") if isinstance(tool, dict) else None
                )
                if not isinstance(provider_data, dict) or not provider_data:
                    provider_data = None
                _flush_member_text(member_state)
                _flush_member_reasoning(member_state)
                tool_block = _find_tool_block(member_content, tool_id)
                if tool_block is None:
                    member_content.append(
                        {
                            "type": "tool_call",
                            "id": tool_id,
                            "toolName": tool.get("toolName"),
                            "toolArgs": tool.get("toolArgs"),
                            "isCompleted": False,
                            **(
                                {"providerData": provider_data} if provider_data else {}
                            ),
                        }
                    )
                else:
                    tool_block["toolName"] = tool.get("toolName") or tool_block.get(
                        "toolName"
                    )
                    tool_block["toolArgs"] = tool.get("toolArgs") or tool_block.get(
                        "toolArgs"
                    )
                    tool_block["isCompleted"] = False
                    if provider_data:
                        tool_block["providerData"] = provider_data
                return True

            if event_name == "ToolCallCompleted":
                tool = data.get("tool") or {}
                tool_id = str(tool.get("id") or "")
                if not tool_id:
                    return False
                tool_block = _find_tool_block(member_content, tool_id)
                if tool_block is None:
                    return False
                tool_block["isCompleted"] = True
                tool_block["toolResult"] = tool.get("toolResult")
                return True

            if event_name == "ToolApprovalRequired":
                tool_payload = data.get("tool") or {}
                tools = tool_payload.get("tools")
                if not isinstance(tools, list) or not tools:
                    return False
                _flush_member_text(member_state)
                _flush_member_reasoning(member_state)
                for tool in tools:
                    if not isinstance(tool, dict):
                        continue
                    member_content.append(
                        {
                            "type": "tool_call",
                            "id": tool.get("id"),
                            "toolName": tool.get("toolName"),
                            "toolArgs": tool.get("toolArgs"),
                            "isCompleted": False,
                            "requiresApproval": True,
                            "runId": tool_payload.get("runId"),
                            "toolCallId": tool.get("id"),
                            "approvalStatus": "pending",
                            "editableArgs": tool.get("editableArgs"),
                        }
                    )
                return True

            if event_name == "ToolApprovalResolved":
                tool = data.get("tool") or {}
                tool_id = str(tool.get("id") or "")
                if not tool_id:
                    return False
                tool_block = _find_tool_block(member_content, tool_id)
                if tool_block is None:
                    return False
                status = tool.get("approvalStatus")
                tool_block["approvalStatus"] = status
                if "toolArgs" in tool:
                    tool_block["toolArgs"] = tool.get("toolArgs")
                if status in ("denied", "timeout"):
                    tool_block["isCompleted"] = True
                return True

            if event_name == "MemberRunCompleted":
                _flush_member_text(member_state)
                _flush_member_reasoning(member_state)
                member_block["isCompleted"] = True
                member_runs.pop(member_state.run_id, None)
                return True

            if event_name in {"MemberRunError", "RunError"}:
                _flush_member_text(member_state)
                _flush_member_reasoning(member_state)
                error_content = str(
                    data.get("content") or data.get("error") or "Member run failed"
                )
                member_content.append({"type": "error", "content": error_content})
                member_block["isCompleted"] = True
                member_block["hasError"] = True
                member_runs.pop(member_state.run_id, None)
                return True

            return event_name == "MemberRunStarted"

        if event_name == "RunContent":
            token = str(data.get("content") or "")
            if not token:
                return False
            if current_reasoning and not current_text:
                _flush_current_reasoning()
            current_text += token
            return True

        if event_name == "ReasoningStarted":
            _flush_current_text()
            return True

        if event_name == "ReasoningStep":
            text = str(data.get("reasoningContent") or "")
            if not text:
                return False
            if current_text and not current_reasoning:
                _flush_current_text()
            current_reasoning += text
            return True

        if event_name == "ReasoningCompleted":
            _flush_current_reasoning()
            return True

        if event_name == "ToolCallStarted":
            tool = data.get("tool") or {}
            tool_id = str(tool.get("id") or "")
            if not tool_id:
                return False
            provider_data = tool.get("providerData") if isinstance(tool, dict) else None
            if not isinstance(provider_data, dict) or not provider_data:
                provider_data = None
            _flush_current_text()
            _flush_current_reasoning()
            tool_block = _find_tool_block(content_blocks, tool_id)
            if tool_block is None:
                content_blocks.append(
                    {
                        "type": "tool_call",
                        "id": tool_id,
                        "toolName": tool.get("toolName"),
                        "toolArgs": tool.get("toolArgs"),
                        "isCompleted": False,
                        **({"providerData": provider_data} if provider_data else {}),
                    }
                )
            else:
                tool_block["isCompleted"] = False
                if provider_data:
                    tool_block["providerData"] = provider_data
            return True

        if event_name == "ToolCallCompleted":
            tool = data.get("tool") or {}
            tool_id = str(tool.get("id") or "")
            if not tool_id:
                return False
            tool_block = _find_tool_block(content_blocks, tool_id)
            if tool_block is None:
                return False
            tool_block["isCompleted"] = True
            tool_block["toolResult"] = tool.get("toolResult")
            provider_data = tool.get("providerData") if isinstance(tool, dict) else None
            if isinstance(provider_data, dict) and provider_data:
                tool_block["providerData"] = provider_data
            return True

        if event_name == "ToolApprovalRequired":
            tool_payload = data.get("tool") or {}
            tools = tool_payload.get("tools")
            if not isinstance(tools, list) or not tools:
                return False
            _flush_current_text()
            _flush_current_reasoning()
            for tool in tools:
                if not isinstance(tool, dict):
                    continue
                content_blocks.append(
                    {
                        "type": "tool_call",
                        "id": tool.get("id"),
                        "toolName": tool.get("toolName"),
                        "toolArgs": tool.get("toolArgs"),
                        "isCompleted": False,
                        "requiresApproval": True,
                        "runId": tool_payload.get("runId"),
                        "toolCallId": tool.get("id"),
                        "approvalStatus": "pending",
                        "editableArgs": tool.get("editableArgs"),
                    }
                )
            return True

        if event_name == "ToolApprovalResolved":
            tool = data.get("tool") or {}
            tool_id = str(tool.get("id") or "")
            if not tool_id:
                return False
            tool_block = _find_tool_block(content_blocks, tool_id)
            if tool_block is None:
                return False
            status = tool.get("approvalStatus")
            tool_block["approvalStatus"] = status
            if "toolArgs" in tool:
                tool_block["toolArgs"] = tool.get("toolArgs")
            if status in ("denied", "timeout"):
                tool_block["isCompleted"] = True
            return True

        return False

    def _send_flow_node_event(event_name: str, payload: dict[str, Any]) -> None:
        ch.send_model(
            ChatEvent(
                event=event_name,
                content=json.dumps(payload, default=str),
            )
        )

    try:
        async for item in runtime_run_flow(graph_data, context):
            if isinstance(item, NodeEvent):
                trace_recorder.record(
                    event_type=f"runtime.node.{item.event_type}",
                    payload=item.data or {},
                    node_id=item.node_id,
                    node_type=item.node_type,
                    run_id=item.run_id,
                )
                if item.event_type == "started":
                    if current_text or current_reasoning:
                        _flush_current_text()
                        _flush_current_reasoning()
                    _send_flow_node_event(
                        "FlowNodeStarted",
                        {"nodeId": item.node_id, "nodeType": item.node_type},
                    )
                elif item.event_type == "progress":
                    if primary_agent_id and item.node_id != primary_agent_id:
                        continue
                    token = (item.data or {}).get("token", "")
                    if token:
                        if current_reasoning and not current_text:
                            _flush_current_reasoning()
                        current_text += token
                        ch.send_model(ChatEvent(event="RunContent", content=token))
                        await asyncio.to_thread(
                            save_content,
                            assistant_msg_id,
                            _serialize_content_state(),
                        )
                elif item.event_type == "agent_run_id":
                    run_id = str((item.data or {}).get("run_id") or "")
                    if run_id:
                        trace_recorder.set_root_run_id(run_id)
                        run_control.set_active_run_id(assistant_msg_id, run_id)
                        if chat_id:
                            await broadcaster.update_stream_run_id(chat_id, run_id)
                elif item.event_type == "agent_event":
                    event_data = item.data or {}
                    if (
                        primary_agent_id
                        and item.node_id != primary_agent_id
                        and not event_data.get("memberRunId")
                    ):
                        continue
                    chat_event = _chat_event_from_agent_runtime_event(event_data)
                    if chat_event is not None:
                        ch.send_model(chat_event)

                    if _apply_agent_event_to_content(event_data):
                        await asyncio.to_thread(
                            save_content,
                            assistant_msg_id,
                            _serialize_content_state(),
                        )

                    event_name = str(event_data.get("event") or "")
                    tool_payload = event_data.get("tool")
                    if event_name == "ToolApprovalRequired" and chat_id:
                        await broadcaster.update_stream_status(chat_id, "paused_hitl")
                    elif event_name == "ToolApprovalResolved" and chat_id:
                        await broadcaster.update_stream_status(chat_id, "streaming")
                elif item.event_type == "cancelled":
                    was_cancelled = True
                    terminal_event = "RunCancelled"
                    trace_status = "cancelled"
                    _flush_current_text()
                    _flush_current_reasoning()
                    _flush_all_member_runs()
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
                    _send_flow_node_event(
                        "FlowNodeCompleted",
                        {"nodeId": item.node_id, "nodeType": item.node_type},
                    )
                elif item.event_type == "result":
                    _send_flow_node_event(
                        "FlowNodeResult",
                        {
                            "nodeId": item.node_id,
                            "nodeType": item.node_type,
                            "outputs": (item.data or {}).get("outputs", {}),
                        },
                    )
                    if primary_agent_id and item.node_id == primary_agent_id:
                        primary_output = _pick_text_output(
                            _coerce_event_outputs((item.data or {}).get("outputs", {}))
                        )
                elif item.event_type == "error":
                    error_msg = (item.data or {}).get("error", "Unknown node error")
                    error_text = f"[{item.node_type}] {error_msg}"
                    _send_flow_node_event(
                        "FlowNodeError",
                        {
                            "nodeId": item.node_id,
                            "nodeType": item.node_type,
                            "error": str(error_msg),
                        },
                    )
                    trace_status = "error"
                    trace_error = error_text
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
                trace_recorder.record(
                    event_type="runtime.execution_result",
                    payload={
                        "outputs": {
                            key: {
                                "type": value.type,
                                "value": value.value,
                            }
                            for key, value in item.outputs.items()
                        }
                    },
                )
                final_output = _pick_text_output(item.outputs)

        if terminal_event is not None:
            return

        _flush_current_text()
        _flush_current_reasoning()
        _flush_all_member_runs()

        has_main_text = any(block.get("type") == "text" for block in content_blocks)
        has_member_runs = any(
            block.get("type") == "member_run" for block in content_blocks
        )
        if not has_main_text and not has_member_runs:
            if primary_agent_id:
                if primary_output is not None:
                    final_value = primary_output.value
                    text = str(final_value) if final_value is not None else ""
                    if text:
                        content_blocks.append({"type": "text", "content": text})
                        ch.send_model(ChatEvent(event="RunContent", content=text))
            elif final_output is not None:
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
        trace_status = "completed"
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
        _flush_current_reasoning()
        _flush_all_member_runs()

        error_msg = extract_error_message(str(e))
        trace_status = "error"
        trace_error = error_msg
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

        trace_recorder.finish(status=trace_status, error_message=trace_error)

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

    trace_recorder = ExecutionTraceRecorder(
        kind="agent",
        chat_id=chat_id or None,
        message_id=assistant_msg_id,
        enabled=not ephemeral,
    )
    trace_recorder.start()
    trace_status = "streaming"
    trace_error: str | None = None

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
        run_control.clear_early_cancel(assistant_msg_id)
        trace_recorder.record(
            event_type="runtime.run.cancelled", payload={"early": True}
        )
        trace_status = "cancelled"
        trace_recorder.finish(status=trace_status)
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
    logged_usage_events = 0

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

        name = getattr(chunk, "agent_name", "") or "Agent"
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
            provider_data = _get_tool_provider_data(chunk.tool)
            member_content.append(
                {
                    "type": "tool_call",
                    "id": chunk.tool.tool_call_id,
                    "toolName": chunk.tool.tool_name,
                    "toolArgs": chunk.tool.tool_args,
                    "isCompleted": False,
                    **({"providerData": provider_data} if provider_data else {}),
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
                        **({"providerData": provider_data} if provider_data else {}),
                    },
                )
            )

        elif evt == RunEvent.tool_call_completed:
            tool_result = (
                str(chunk.tool.result) if chunk.tool.result is not None else None
            )
            provider_data = _get_tool_provider_data(chunk.tool)
            for block in member_content:
                if (
                    block["type"] == "tool_call"
                    and block.get("id") == chunk.tool.tool_call_id
                ):
                    block["isCompleted"] = True
                    block["toolResult"] = tool_result
                    if provider_data:
                        block.setdefault("providerData", provider_data)
                    break
            ch.send_model(
                _make_event(
                    event="ToolCallCompleted",
                    tool={
                        "id": chunk.tool.tool_call_id,
                        "toolName": chunk.tool.tool_name,
                        "toolResult": tool_result,
                        **({"providerData": provider_data} if provider_data else {}),
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

    def _chunk_trace_payload(chunk: Any) -> dict[str, Any]:
        payload: dict[str, Any] = {}

        content = getattr(chunk, "content", None)
        if content is not None:
            payload["content"] = str(content)

        reasoning_content = getattr(chunk, "reasoning_content", None)
        if reasoning_content is not None:
            payload["reasoningContent"] = str(reasoning_content)

        agent_name = getattr(chunk, "agent_name", None)
        if agent_name:
            payload["agentName"] = str(agent_name)

        tool = getattr(chunk, "tool", None)
        if tool is not None:
            payload["tool"] = {
                "id": getattr(tool, "tool_call_id", None),
                "name": getattr(tool, "tool_name", None),
                "args": getattr(tool, "tool_args", None),
                "result": (
                    None
                    if getattr(tool, "result", None) is None
                    else str(getattr(tool, "result", None))
                ),
            }

        return payload

    try:
        while True:
            async for chunk in response_stream:
                if not run_id and chunk.run_id:
                    run_id = chunk.run_id
                    trace_recorder.set_root_run_id(run_id)
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

                trace_recorder.record(
                    event_type=f"runtime.event.{evt.value}",
                    run_id=str(getattr(chunk, "run_id", "") or "") or None,
                    payload=_chunk_trace_payload(chunk),
                )

                if evt == RunEvent.model_request_completed:
                    _log_token_usage(
                        run_id=run_id or getattr(chunk, "run_id", None),
                        model=getattr(chunk, "model", None),
                        provider=getattr(chunk, "model_provider", None),
                        input_tokens=getattr(chunk, "input_tokens", None),
                        output_tokens=getattr(chunk, "output_tokens", None),
                        total_tokens=getattr(chunk, "total_tokens", None),
                        cache_read_tokens=getattr(chunk, "cache_read_tokens", None),
                        cache_write_tokens=getattr(chunk, "cache_write_tokens", None),
                        reasoning_tokens=getattr(chunk, "reasoning_tokens", None),
                        time_to_first_token=getattr(chunk, "time_to_first_token", None),
                    )
                    logged_usage_events += 1

                if active_delegation_tool_id and _is_member_event(chunk):
                    await _handle_member_event(evt, chunk)
                    continue

                if evt == RunEvent.run_cancelled:
                    trace_status = "cancelled"
                    flush_text()
                    flush_reasoning()
                    await asyncio.to_thread(
                        save_content, assistant_msg_id, save_final()
                    )
                    if not ephemeral:
                        with db.db_session() as sess:
                            db.mark_message_complete(sess, assistant_msg_id)
                    run_control.remove_active_run(assistant_msg_id)
                    run_control.clear_early_cancel(assistant_msg_id)
                    ch.send_model(ChatEvent(event="RunCancelled"))
                    if chat_id:
                        await broadcaster.update_stream_status(chat_id, "completed")
                        await broadcaster.unregister_stream(chat_id)
                    trace_recorder.finish(status=trace_status)
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
                        provider_data = _get_tool_provider_data(chunk.tool)
                        content_blocks.append(
                            {
                                "type": "tool_call",
                                "id": chunk.tool.tool_call_id,
                                "toolName": chunk.tool.tool_name,
                                "toolArgs": chunk.tool.tool_args,
                                "isCompleted": False,
                                "isDelegation": True,
                                **(
                                    {"providerData": provider_data}
                                    if provider_data
                                    else {}
                                ),
                            }
                        )
                        continue

                    flush_text()
                    flush_reasoning()
                    provider_data = _get_tool_provider_data(chunk.tool)
                    ch.send_model(
                        ChatEvent(
                            event="ToolCallStarted",
                            tool={
                                "id": chunk.tool.tool_call_id,
                                "toolName": chunk.tool.tool_name,
                                "toolArgs": chunk.tool.tool_args,
                                "isCompleted": False,
                                **(
                                    {"providerData": provider_data}
                                    if provider_data
                                    else {}
                                ),
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

                    provider_data = _get_tool_provider_data(chunk.tool)
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
                        **({"providerData": provider_data} if provider_data else {}),
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
                    if logged_usage_events == 0:
                        metrics = getattr(chunk, "metrics", None)
                        if metrics:
                            _log_token_usage(
                                run_id=run_id or getattr(chunk, "run_id", None),
                                model=getattr(chunk, "model", None),
                                provider=getattr(chunk, "model_provider", None),
                                input_tokens=getattr(metrics, "input_tokens", None),
                                output_tokens=getattr(metrics, "output_tokens", None),
                                total_tokens=getattr(metrics, "total_tokens", None),
                                cache_read_tokens=getattr(
                                    metrics, "cache_read_tokens", None
                                ),
                                cache_write_tokens=getattr(
                                    metrics, "cache_write_tokens", None
                                ),
                                reasoning_tokens=getattr(
                                    metrics, "reasoning_tokens", None
                                ),
                                time_to_first_token=getattr(
                                    metrics, "time_to_first_token", None
                                ),
                            )
                    trace_status = "completed"
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
                    trace_recorder.finish(status=trace_status)
                    return

                elif evt == RunEvent.run_error:
                    flush_text()
                    flush_reasoning()
                    error_msg = extract_error_message(
                        chunk.content if chunk.content else str(chunk)
                    )
                    trace_status = "error"
                    trace_error = error_msg
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
                    run_control.remove_active_run(assistant_msg_id)
                    run_control.clear_early_cancel(assistant_msg_id)
                    trace_recorder.finish(
                        status=trace_status, error_message=trace_error
                    )
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

        if trace_status == "streaming":
            flush_text()
            flush_reasoning()
            error_msg = "Run ended unexpectedly"
            trace_status = "error"
            trace_error = error_msg
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
                logger.error(f"[stream] Failed to save state on close: {save_err}")
            ch.send_model(ChatEvent(event="RunError", content=error_msg))
            if chat_id:
                await broadcaster.update_stream_status(chat_id, "error", error_msg)
                await broadcaster.unregister_stream(chat_id)

    except asyncio.CancelledError:
        if run_id:
            run_control.clear_approval(run_id)
        raise
    except Exception as e:
        logger.error(f"[stream] Exception in stream handler: {e}")
        flush_text()
        flush_reasoning()
        error_msg = extract_error_message(str(e))
        trace_status = "error"
        trace_error = error_msg
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

    trace_recorder.finish(status=trace_status, error_message=trace_error)

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
    agent_id: str | None = None,
    extra_tool_ids: list[str] | None = None,
    flow_stream_handler: FlowStreamHandler | None = None,
) -> None:
    _require_user_message(messages)
    await ensure_mcp_initialized()

    handler = flow_stream_handler or handle_flow_stream

    await handler(
        graph_data,
        None,
        messages,
        assistant_msg_id,
        channel,
        chat_id=chat_id,
        ephemeral=ephemeral,
        agent_id=agent_id,
        extra_tool_ids=extra_tool_ids,
    )
