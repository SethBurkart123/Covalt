from __future__ import annotations

import asyncio
import copy
import json
import logging
import traceback
import types
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from zynk import Channel

from backend.runtime import (
    AgentConfig,
    ApprovalRequired,
    ApprovalResponse,
    ContentDelta,
    ModelUsage,
    ReasoningCompleted,
    ReasoningDelta,
    ReasoningStarted,
    RunCancelled,
    RunCompleted,
    RunError,
    RuntimeAdapter,
    ToolCallCompleted,
    ToolCallStarted,
    ToolDecision,
    get_adapter,
    runtime_message_to_dict,
    runtime_messages_from_chat_messages,
)
from nodes import get_executor
from nodes._types import DataValue, ExecutionResult, HookType, NodeEvent, RuntimeConfigContext
from nodes.node_type_ids import AGENT_NODE_TYPE, CHAT_START_NODE_TYPE

from .. import db
from ..db.models import ToolCall as DbToolCall
from ..models import (
    parse_message_blocks,
    serialize_message_blocks,
)
from ..models.chat import ChatEvent, ChatMessage, ToolCallPayload
from . import run_control
from . import stream_broadcaster as broadcaster
from .agent_manager import get_agent_manager
from .execution_trace import ExecutionTraceRecorder
from .flow_executor import run_flow
from .flow_migration import migrate_graph_data, requires_graph_migration
from .mcp_manager import ensure_mcp_initialized
from .model_selection import parse_model_id
from .plugin_registry import dispatch_hook
from .render_plan_builder import get_render_plan_builder
from .runtime_events import (
    EVENT_FLOW_NODE_COMPLETED,
    EVENT_FLOW_NODE_ERROR,
    EVENT_FLOW_NODE_RESULT,
    EVENT_FLOW_NODE_STARTED,
    EVENT_MEMBER_RUN_COMPLETED,
    EVENT_MEMBER_RUN_ERROR,
    EVENT_MEMBER_RUN_STARTED,
    EVENT_REASONING_COMPLETED,
    EVENT_REASONING_STARTED,
    EVENT_REASONING_STEP,
    EVENT_RUN_CANCELLED,
    EVENT_RUN_COMPLETED,
    EVENT_RUN_CONTENT,
    EVENT_RUN_ERROR,
    EVENT_TOOL_APPROVAL_REQUIRED,
    EVENT_TOOL_APPROVAL_RESOLVED,
    EVENT_TOOL_CALL_COMPLETED,
    EVENT_TOOL_CALL_STARTED,
    emit_chat_event,
    make_chat_event,
)
from .tool_registry import get_original_tool_name, get_tool_registry
from .toolset_executor import get_toolset_executor
from .workspace_manager import get_workspace_manager

FlowStreamHandler = Callable[..., Awaitable[None]]
ContentMessageConverter = Callable[[ChatMessage, str | None], list[Any]]
_RUNTIME_ADAPTER: RuntimeAdapter = get_adapter()

logger = logging.getLogger(__name__)
registry = get_tool_registry()

DELEGATION_TOOL_NAMES = {"delegate_task_to_member", "delegate_task_to_members"}

MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

COVALT_ALLOWED_ATTACHMENT_MIME_TYPES = [
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
    hook_results = dispatch_hook(
        HookType.ON_ENTRY_RESOLVE,
        {
            "mode": "chat",
            "nodes_by_id": nodes_by_id,
            "upstream_by_node": upstream_by_node,
        },
    )

    candidate_ids: set[str] = set()
    candidate_types: set[str] = set()

    def _collect_candidate(raw: Any) -> None:
        if isinstance(raw, str) and raw.strip():
            value = raw.strip()
            if value in nodes_by_id:
                candidate_ids.add(value)
                return
            candidate_types.add(value)
            return
        if isinstance(raw, dict):
            node_id = raw.get("node_id")
            if isinstance(node_id, str) and node_id.strip() and node_id.strip() in nodes_by_id:
                candidate_ids.add(node_id.strip())
            node_type = raw.get("node_type")
            if isinstance(node_type, str) and node_type.strip():
                candidate_types.add(node_type.strip())

    for result in hook_results:
        if isinstance(result, list):
            for item in result:
                _collect_candidate(item)
            continue
        _collect_candidate(result)

    preferred_ids = sorted(candidate_ids)
    if candidate_types:
        preferred_ids.extend(
            sorted(
                node_id
                for node_id, node in nodes_by_id.items()
                if str(node.get("type") or "") in candidate_types
                and node_id not in candidate_ids
            )
        )

    if preferred_ids:
        return preferred_ids

    chat_start_ids = sorted(
        node_id
        for node_id, node in nodes_by_id.items()
        if str(node.get("type") or "") == CHAT_START_NODE_TYPE
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
    runtime_messages: list[Any],
    attachments: list[dict[str, Any]],
) -> dict[str, Any]:
    serialized_messages = [
        runtime_message_to_dict(message)
        if hasattr(message, "role")
        else dict(message)
        for message in runtime_messages
        if hasattr(message, "role") or isinstance(message, dict)
    ]
    return {
        "message": user_message,
        "last_user_message": user_message,
        "history": serialized_messages,
        "messages": serialized_messages,
        "attachments": attachments,
    }


def _is_delegation_tool(tool_name: str | None) -> bool:
    return tool_name in DELEGATION_TOOL_NAMES


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

    The graph runtime path does not have a single long-lived agent handle at
    adapter level.  This handle binds to whichever ``AgentHandle`` is active in
    the agent node and proxies cancellation through the runtime protocol.
    """

    def __init__(self) -> None:
        self._handle: Any = None
        self._run_id: str | None = None
        self._cancel_requested = False

    def _apply_cancel_if_ready(self) -> None:
        if not self._cancel_requested or self._handle is None or not self._run_id:
            return

        try:
            self._handle.cancel(self._run_id)
        except Exception:
            logger.exception("[flow_stream] Failed to cancel bound agent run")

    def bind_agent(self, handle: Any) -> None:
        self._handle = handle
        self._apply_cancel_if_ready()

    def set_run_id(self, run_id: str) -> None:
        if run_id:
            self._run_id = run_id
        self._apply_cancel_if_ready()

    def request_cancel(self) -> None:
        self._cancel_requested = True
        self._apply_cancel_if_ready()

    def cancel(self, run_id: str | None = None) -> None:
        if run_id:
            self._run_id = run_id
        self.request_cancel()

    def is_cancel_requested(self) -> bool:
        return self._cancel_requested


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
    model_options: dict[str, Any] | None = None,
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
    if model_options is not None:
        agent_data["model_options"] = dict(model_options)

    return {
        "nodes": [
            {
                "id": "entry-1",
                "type": CHAT_START_NODE_TYPE,
                "position": {"x": 120.0, "y": 160.0},
                "data": {"includeUserTools": True},
            },
            {
                "id": "agent-1",
                "type": AGENT_NODE_TYPE,
                "position": {"x": 420.0, "y": 160.0},
                "data": agent_data,
            },
        ],
        "edges": [
            {
                "id": "e-entry-1-agent-1",
                "source": "entry-1",
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
    model_id: str | None,
    model_options: dict[str, Any] | None = None,
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
                model_options=model_options,
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
        model_options=model_options,
    )


def _require_user_message(messages: list[ChatMessage]) -> None:
    if not messages or messages[-1].role != "user":
        raise ValueError("No user message found in request")


def is_allowed_attachment_mime(mime_type: str) -> bool:
    if not mime_type:
        return False

    for prefix, wildcard in [
        ("image/", "image/*"),
        ("audio/", "audio/*"),
        ("video/", "video/*"),
    ]:
        if mime_type.startswith(prefix):
            return wildcard in COVALT_ALLOWED_ATTACHMENT_MIME_TYPES

    return mime_type in COVALT_ALLOWED_ATTACHMENT_MIME_TYPES


def extract_error_message(error_content: str) -> str:
    if not error_content:
        return "Something went wrong. Please try again."

    text = str(error_content).strip()

    json_start = text.find("{")
    if json_start != -1:
        try:
            data = json.loads(text[json_start:])
            if isinstance(data, dict):
                if "error" in data and isinstance(data["error"], dict):
                    msg = data["error"].get("message")
                    if isinstance(msg, str) and msg.strip():
                        text = msg.strip()
                elif "message" in data and isinstance(data["message"], str):
                    text = data["message"].strip()
        except json.JSONDecodeError:
            pass

    first_line = text.splitlines()[0].strip()
    if first_line:
        text = first_line

    if not text:
        return "Something went wrong. Please try again."

    max_len = 1000
    if len(text) > max_len:
        text = text[: max_len - 3].rstrip() + "..."

    return text


def is_toolset_tool(tool_name: str) -> bool:
    return (
        ":" in tool_name
        and not tool_name.startswith("mcp:")
        and not tool_name.startswith("-")
    )


def _load_tool_call_render_plan(tool_call_id: str | None) -> dict[str, Any] | None:
    if not tool_call_id:
        return None
    try:
        with db.db_session() as sess:
            tool_call = (
                sess.query(DbToolCall).filter(DbToolCall.id == tool_call_id).first()
            )
            if tool_call and tool_call.render_plan:
                return json.loads(tool_call.render_plan)
            if tool_call and not tool_call.render_plan:
                logger.warning(
                    f"Tool call {tool_call_id} missing render_plan in db."
                )
            if not tool_call:
                logger.warning(f"Tool call {tool_call_id} not found in db.")
    except Exception as exc:
        logger.warning(f"Failed to load render plan for tool call {tool_call_id}: {exc}")
    return None


def _did_tool_call_fail(tool_name: str, tool_call_id: str | None) -> bool:
    if not tool_call_id or not tool_name or not is_toolset_tool(tool_name):
        return False

    try:
        with db.db_session() as sess:
            tool_call = (
                sess.query(DbToolCall).filter(DbToolCall.id == tool_call_id).first()
            )
            if not tool_call:
                return False
            return tool_call.status == "error"
    except Exception as exc:
        logger.warning(f"Failed to load status for tool call {tool_call_id}: {exc}")
        return False


def _parse_tool_result(tool_result: Any) -> Any:
    if tool_result is None:
        return None
    if isinstance(tool_result, str):
        try:
            return json.loads(tool_result)
        except json.JSONDecodeError:
            return tool_result
    return tool_result


def _has_unresolved_render_ref(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().startswith("$")
    if isinstance(value, dict):
        return any(_has_unresolved_render_ref(v) for v in value.values())
    if isinstance(value, list):
        return any(_has_unresolved_render_ref(v) for v in value)
    return False


def _is_invalid_render_plan(render_plan: dict[str, Any] | None) -> bool:
    if render_plan is None:
        return False
    if not isinstance(render_plan, dict):
        return True

    config = render_plan.get("config")
    if not isinstance(config, dict):
        return False

    for key in ("file", "path", "url", "artifact"):
        if key in config and _has_unresolved_render_ref(config.get(key)):
            return True

    return False


def _resolve_tool_render_plan(
    *,
    tool_name: str,
    tool_args: dict[str, Any] | None,
    tool_result: Any,
    tool_call_id: str | None,
    chat_id: str | None,
    provided_plan: dict[str, Any] | None = None,
    failed: bool = False,
) -> dict[str, Any] | None:
    if failed:
        return None

    if provided_plan is not None:
        return provided_plan

    render_plan = None
    if tool_name and is_toolset_tool(tool_name):
        if tool_call_id:
            render_plan = get_toolset_executor().consume_render_plan(tool_call_id)
        if render_plan is None and tool_call_id:
            render_plan = _load_tool_call_render_plan(tool_call_id)
        if render_plan is None:
            render_plan = _generate_toolset_render_plan(
                tool_name=tool_name,
                tool_args=tool_args,
                tool_result=tool_result,
                chat_id=chat_id,
            )

    if render_plan is None and tool_name:
        renderer = registry.get_renderer(tool_name)
        if renderer:
            render_plan = {"renderer": renderer, "config": {}}

    return render_plan


def _build_tool_call_completed_payload(
    *,
    tool_id: str,
    tool_name: str,
    tool_args: dict[str, Any] | None,
    tool_result: Any,
    provider_data: dict[str, Any] | None = None,
    render_plan: dict[str, Any] | None = None,
    chat_id: str | None = None,
    failed: bool = False,
) -> dict[str, Any]:
    safe_args = tool_args if isinstance(tool_args, dict) else {}
    tool_result_text = str(tool_result) if tool_result is not None else None
    resolved_plan = _resolve_tool_render_plan(
        tool_name=tool_name,
        tool_args=safe_args,
        tool_result=tool_result,
        tool_call_id=tool_id or None,
        chat_id=chat_id,
        provided_plan=render_plan,
        failed=failed,
    )

    if failed or _is_invalid_render_plan(resolved_plan):
        resolved_plan = None
        failed = True
    tool_block: dict[str, Any] = {
        "id": tool_id,
        "toolName": tool_name,
        "toolArgs": safe_args,
        "toolResult": tool_result_text,
        "isCompleted": True,
    }
    if failed:
        tool_block["failed"] = True
    if provider_data:
        tool_block["providerData"] = provider_data
    if resolved_plan is not None:
        tool_block["renderPlan"] = resolved_plan
    return ToolCallPayload.model_validate(tool_block).model_dump()


def _ensure_tool_call_completed_payload(
    payload: dict[str, Any], chat_id: str | None
) -> None:
    event_name = str(payload.get("event") or "")
    if event_name != EVENT_TOOL_CALL_COMPLETED:
        return

    tool = payload.get("tool")
    if not isinstance(tool, dict):
        return

    tool_id = str(tool.get("id") or "")
    tool_name_value = tool.get("toolName")
    tool_name = (
        tool_name_value
        if isinstance(tool_name_value, str)
        else str(tool_name_value or "")
    )
    if not tool_id or not tool_name:
        return

    provider_data = tool.get("providerData")
    if not isinstance(provider_data, dict) or not provider_data:
        provider_data = None

    payload["tool"] = _build_tool_call_completed_payload(
        tool_id=tool_id,
        tool_name=tool_name,
        tool_args=tool.get("toolArgs") if isinstance(tool.get("toolArgs"), dict) else None,
        tool_result=tool.get("toolResult"),
        provider_data=provider_data,
        render_plan=tool.get("renderPlan")
        if isinstance(tool.get("renderPlan"), dict)
        else None,
        chat_id=chat_id,
        failed=bool(tool.get("failed")) or _did_tool_call_fail(tool_name, tool_id),
    )


def _generate_toolset_render_plan(
    *,
    tool_name: str | None,
    tool_args: dict[str, Any] | None,
    tool_result: Any,
    chat_id: str | None,
) -> dict[str, Any] | None:
    if not tool_name or not chat_id:
        return None
    try:
        executor = get_toolset_executor()
        tool_info = executor.get_tool_metadata(tool_name)
        if not tool_info:
            return None

        render_config = tool_info.get("render_config")
        if not isinstance(render_config, dict):
            return None

        config = render_config.get("config", {})
        toolset_dir = Path(executor.get_toolset_directory(tool_name))
        context = {
            "args": tool_args or {},
            "return": _parse_tool_result(tool_result),
            "chat_id": chat_id,
            "workspace": str(get_workspace_manager(chat_id).workspace_dir),
            "toolset": str(toolset_dir),
        }

        plan = get_render_plan_builder().build(
            renderer=str(render_config.get("renderer") or "default"),
            config=config if isinstance(config, dict) else {},
            context=context,
            toolset_dir=toolset_dir,
        )

        if plan["renderer"] == "html" and "artifact" in plan["config"] and "content" not in plan["config"]:
            logger.warning("Artifact not found: %s", plan["config"]["artifact"])

        return plan
    except Exception as exc:
        logger.warning(f"Failed to generate render plan for tool {tool_name}: {exc}")
        return None


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
            sess,
            messageId=message_id,
            content=serialize_message_blocks(blocks),
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

    return make_chat_event(event_name, allow_unknown=True, **{k: v for k, v in payload.items() if k != "event"})


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
        emit_chat_event(ch, EVENT_RUN_CANCELLED)
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
        for attachment in last_user_message.attachments or []:
            if isinstance(attachment, dict):
                last_user_attachments.append(dict(attachment))
            elif hasattr(attachment, "model_dump"):
                payload = attachment.model_dump()
                if isinstance(payload, dict):
                    last_user_attachments.append(payload)

    runtime_messages = runtime_messages_from_chat_messages(messages, chat_id)
    if requires_graph_migration(graph_data):
        normalized_graph_data = migrate_graph_data(graph_data)
    else:
        normalized_graph_data = graph_data
    entry_node_ids = _build_entry_node_ids(normalized_graph_data)
    trigger_payload = _build_trigger_payload(
        user_message,
        runtime_messages,
        last_user_attachments,
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
            runtime_messages=runtime_messages,
        ),
        expression_context={"trigger": trigger_payload},
        execution=types.SimpleNamespace(entry_node_ids=entry_node_ids),
    )
    _apply_runtime_config(normalized_graph_data, services, mode="chat")
    if services is not None:
        chat_output = getattr(services, "chat_output", None)
        if (
            chat_output is not None
            and not getattr(chat_output, "primary_agent_id", None)
            and _count_agent_nodes(normalized_graph_data) > 1
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

            if event_name == EVENT_RUN_CONTENT:
                text = str(data.get("content") or "")
                if not text:
                    return False
                if member_state.current_reasoning and not member_state.current_text:
                    _flush_member_reasoning(member_state)
                member_state.current_text += text
                return True

            if event_name == EVENT_REASONING_STARTED:
                _flush_member_text(member_state)
                return True

            if event_name == EVENT_REASONING_STEP:
                text = str(data.get("reasoningContent") or "")
                if not text:
                    return False
                if member_state.current_text and not member_state.current_reasoning:
                    _flush_member_text(member_state)
                member_state.current_reasoning += text
                return True

            if event_name == EVENT_REASONING_COMPLETED:
                _flush_member_reasoning(member_state)
                return True

            if event_name == EVENT_TOOL_CALL_STARTED:
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

            if event_name == EVENT_TOOL_CALL_COMPLETED:
                tool = data.get("tool") or {}
                tool_id = str(tool.get("id") or "")
                if not tool_id:
                    return False
                tool_block = _find_tool_block(member_content, tool_id)
                if tool_block is None:
                    return False
                tool_block["isCompleted"] = True
                tool_block["toolResult"] = tool.get("toolResult")
                if bool(tool.get("failed")):
                    tool_block["failed"] = True
                    tool_block.pop("renderPlan", None)
                elif "renderPlan" in tool:
                    tool_block["renderPlan"] = tool.get("renderPlan")
                return True

            if event_name == EVENT_TOOL_APPROVAL_REQUIRED:
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

            if event_name == EVENT_TOOL_APPROVAL_RESOLVED:
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

            if event_name == EVENT_MEMBER_RUN_COMPLETED:
                _flush_member_text(member_state)
                _flush_member_reasoning(member_state)
                member_block["isCompleted"] = True
                member_runs.pop(member_state.run_id, None)
                return True

            if event_name in {EVENT_MEMBER_RUN_ERROR, EVENT_RUN_ERROR}:
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

            return event_name == EVENT_MEMBER_RUN_STARTED

        if event_name == EVENT_RUN_CONTENT:
            token = str(data.get("content") or "")
            if not token:
                return False
            if current_reasoning and not current_text:
                _flush_current_reasoning()
            current_text += token
            return True

        if event_name == EVENT_REASONING_STARTED:
            _flush_current_text()
            return True

        if event_name == EVENT_REASONING_STEP:
            text = str(data.get("reasoningContent") or "")
            if not text:
                return False
            if current_text and not current_reasoning:
                _flush_current_text()
            current_reasoning += text
            return True

        if event_name == EVENT_REASONING_COMPLETED:
            _flush_current_reasoning()
            return True

        if event_name == EVENT_TOOL_CALL_STARTED:
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

        if event_name == EVENT_TOOL_CALL_COMPLETED:
            tool = data.get("tool") or {}
            tool_id = str(tool.get("id") or "")
            if not tool_id:
                return False
            tool_block = _find_tool_block(content_blocks, tool_id)
            if tool_block is None:
                return False
            tool_block["isCompleted"] = True
            tool_block["toolResult"] = tool.get("toolResult")
            if "renderPlan" in tool:
                tool_block["renderPlan"] = tool.get("renderPlan")
            provider_data = tool.get("providerData") if isinstance(tool, dict) else None
            if isinstance(provider_data, dict) and provider_data:
                tool_block["providerData"] = provider_data
            return True

        if event_name == EVENT_TOOL_APPROVAL_REQUIRED:
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

        if event_name == EVENT_TOOL_APPROVAL_RESOLVED:
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
        emit_chat_event(
            ch,
            event_name,
            content=json.dumps(payload, default=str),
            allow_unknown=True,
        )

    try:
        async for item in runtime_run_flow(normalized_graph_data, context):
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
                        EVENT_FLOW_NODE_STARTED,
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
                        emit_chat_event(ch, EVENT_RUN_CONTENT, content=token)
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
                    _ensure_tool_call_completed_payload(event_data, chat_id or None)
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
                    if event_name == EVENT_TOOL_APPROVAL_REQUIRED and chat_id:
                        await broadcaster.update_stream_status(chat_id, "paused_hitl")
                    elif event_name == EVENT_TOOL_APPROVAL_RESOLVED and chat_id:
                        await broadcaster.update_stream_status(chat_id, "streaming")
                elif item.event_type == "cancelled":
                    was_cancelled = True
                    terminal_event = EVENT_RUN_CANCELLED
                    trace_status = "cancelled"
                    _flush_current_text()
                    _flush_current_reasoning()
                    _flush_all_member_runs()
                    await asyncio.to_thread(
                        save_content,
                        assistant_msg_id,
                        json.dumps(content_blocks),
                    )
                    emit_chat_event(ch, EVENT_RUN_CANCELLED)
                    if chat_id:
                        await broadcaster.update_stream_status(chat_id, "completed")
                        await broadcaster.unregister_stream(chat_id)
                    return
                elif item.event_type == "completed":
                    _send_flow_node_event(
                        EVENT_FLOW_NODE_COMPLETED,
                        {"nodeId": item.node_id, "nodeType": item.node_type},
                    )
                elif item.event_type == "result":
                    _send_flow_node_event(
                        EVENT_FLOW_NODE_RESULT,
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
                        EVENT_FLOW_NODE_ERROR,
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
                    emit_chat_event(ch, EVENT_RUN_ERROR, content=error_text)
                    await asyncio.to_thread(
                        save_content, assistant_msg_id, json.dumps(content_blocks)
                    )
                    had_error = True
                    terminal_event = EVENT_RUN_ERROR
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
                        emit_chat_event(ch, EVENT_RUN_CONTENT, content=text)
            elif final_output is not None:
                final_value = final_output.value
                text = str(final_value) if final_value is not None else ""
                if text:
                    content_blocks.append({"type": "text", "content": text})
                    emit_chat_event(ch, EVENT_RUN_CONTENT, content=text)

        await asyncio.to_thread(
            save_content, assistant_msg_id, json.dumps(content_blocks)
        )

        if not ephemeral:
            with db.db_session() as sess:
                db.mark_message_complete(sess, assistant_msg_id)

        terminal_event = EVENT_RUN_COMPLETED
        trace_status = "completed"
        emit_chat_event(ch, EVENT_RUN_COMPLETED)

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
        emit_chat_event(ch, EVENT_RUN_ERROR, content=error_msg)
        had_error = True
        terminal_event = EVENT_RUN_ERROR

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
    agent: Any,
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
    del convert_message

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

    runtime_messages = runtime_messages_from_chat_messages(messages, chat_id or None)
    agent_handle = _RUNTIME_ADAPTER.create_agent(
        AgentConfig(name=getattr(agent, "name", "Agent") or "Agent", model=None),
        runnable=agent,
    )

    if chat_id:
        await broadcaster.register_stream(chat_id, assistant_msg_id)

    run_control.register_active_run(assistant_msg_id, agent_handle)

    if run_control.consume_early_cancel(assistant_msg_id):
        run_control.remove_active_run(assistant_msg_id)
        run_control.clear_early_cancel(assistant_msg_id)
        trace_recorder.record(
            event_type="runtime.run.cancelled", payload={"early": True}
        )
        trace_status = "cancelled"
        trace_recorder.finish(status=trace_status)
        emit_chat_event(ch, EVENT_RUN_CANCELLED)
        if chat_id:
            await broadcaster.update_stream_status(chat_id, "completed")
            await broadcaster.unregister_stream(chat_id)
        return

    response_stream = agent_handle.run(runtime_messages, add_history_to_context=True)
    content_blocks = [] if ephemeral else load_initial_fn(assistant_msg_id)
    current_text = ""
    current_reasoning = ""
    had_error = False
    run_id: str | None = None
    logged_usage_events = 0

    active_delegation_tool_id: str | None = None
    delegation_task = ""
    member_runs: dict[str, MemberRunState] = {}

    def _find_tool_block(
        blocks: list[dict[str, Any]], tool_id: str
    ) -> dict[str, Any] | None:
        for block in blocks:
            if block.get("type") == "tool_call" and block.get("id") == tool_id:
                return block
        return None

    def _flush_text() -> None:
        nonlocal current_text
        if not current_text:
            return
        content_blocks.append({"type": "text", "content": current_text})
        current_text = ""

    def _flush_reasoning() -> None:
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

    def _get_member_run(event: Any) -> MemberRunState | None:
        member_run_id = str(getattr(event, "member_run_id", "") or "")
        if not member_run_id:
            return None

        member_name = str(getattr(event, "member_name", "") or "Agent")
        if member_run_id in member_runs:
            member_state = member_runs[member_run_id]
            if member_name:
                member_state.name = member_name
                content_blocks[member_state.block_index]["memberName"] = member_name
            return member_state

        block = {
            "type": "member_run",
            "runId": member_run_id,
            "memberName": member_name,
            "content": [],
            "isCompleted": False,
            "task": str(getattr(event, "task", None) or delegation_task),
        }
        content_blocks.append(block)
        member_state = MemberRunState(
            run_id=member_run_id,
            name=member_name,
            block_index=len(content_blocks) - 1,
        )
        member_runs[member_run_id] = member_state
        emit_chat_event(
            ch,
            EVENT_MEMBER_RUN_STARTED,
            memberName=member_name,
            memberRunId=member_run_id,
            task=block["task"],
        )
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
            emit_chat_event(
                ch,
                EVENT_MEMBER_RUN_COMPLETED,
                memberName=member_state.name,
                memberRunId=member_state.run_id,
            )
        member_runs.clear()

    def _serialize_state() -> str:
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
            member_content = member_block["content"]
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

    def _save_final() -> str:
        return json.dumps(content_blocks)

    async def _persist_state(final: bool = False) -> None:
        payload = _save_final() if final else _serialize_state()
        await asyncio.to_thread(save_content, assistant_msg_id, payload)

    def _trace_payload(event: Any) -> dict[str, Any]:
        payload: dict[str, Any] = {}
        if getattr(event, "run_id", None):
            payload["runId"] = event.run_id
        if getattr(event, "member_run_id", None):
            payload["memberRunId"] = event.member_run_id
        if getattr(event, "member_name", None):
            payload["memberName"] = event.member_name
        if isinstance(event, ContentDelta):
            payload["content"] = event.text
        elif isinstance(event, ReasoningDelta):
            payload["reasoningContent"] = event.text
        elif isinstance(event, ToolCallStarted) and event.tool is not None:
            payload["tool"] = {
                "id": event.tool.id,
                "name": event.tool.name,
                "args": event.tool.arguments,
            }
        elif isinstance(event, ToolCallCompleted) and event.tool is not None:
            payload["tool"] = {
                "id": event.tool.id,
                "name": event.tool.name,
                "args": None,
                "result": event.tool.result,
            }
        elif isinstance(event, ApprovalRequired):
            payload["tools"] = [tool.tool_call_id for tool in event.tools]
        elif isinstance(event, RunError):
            payload["message"] = event.message
        return payload

    try:
        while True:
            async for event in response_stream:
                if not run_id and getattr(event, "run_id", None):
                    run_id = event.run_id
                    trace_recorder.set_root_run_id(run_id)
                    run_control.set_active_run_id(assistant_msg_id, run_id)
                    logger.info("[stream] Captured run_id %s", run_id)
                    if chat_id:
                        await broadcaster.update_stream_run_id(chat_id, run_id)
                    if run_control.consume_early_cancel(assistant_msg_id):
                        logger.info("[stream] Early cancel detected for %s", run_id)
                        agent_handle.cancel(run_id)

                trace_recorder.record(
                    event_type=f"runtime.event.{event.__class__.__name__}",
                    run_id=getattr(event, "run_id", None),
                    payload=_trace_payload(event),
                )

                if isinstance(event, ModelUsage):
                    _log_token_usage(
                        run_id=run_id or event.run_id,
                        model=event.model,
                        provider=event.provider,
                        input_tokens=event.input_tokens,
                        output_tokens=event.output_tokens,
                        total_tokens=event.total_tokens,
                        cache_read_tokens=event.cache_read_tokens,
                        cache_write_tokens=event.cache_write_tokens,
                        reasoning_tokens=event.reasoning_tokens,
                        time_to_first_token=event.time_to_first_token,
                    )
                    logged_usage_events += 1
                    continue

                member_state = _get_member_run(event)
                if member_state is not None and active_delegation_tool_id:
                    member_content = content_blocks[member_state.block_index]["content"]
                    member_event_kwargs = {
                        "memberName": member_state.name,
                        "memberRunId": member_state.run_id,
                    }

                    if isinstance(event, ContentDelta):
                        if member_state.current_reasoning and not member_state.current_text:
                            _flush_member_reasoning(member_state)
                        member_state.current_text += event.text
                        emit_chat_event(
                            ch,
                            EVENT_RUN_CONTENT,
                            content=event.text,
                            **member_event_kwargs,
                        )
                        await _persist_state()
                        continue

                    if isinstance(event, ReasoningStarted):
                        _flush_member_text(member_state)
                        emit_chat_event(ch, EVENT_REASONING_STARTED, **member_event_kwargs)
                        continue

                    if isinstance(event, ReasoningDelta):
                        if member_state.current_text and not member_state.current_reasoning:
                            _flush_member_text(member_state)
                        member_state.current_reasoning += event.text
                        emit_chat_event(
                            ch,
                            EVENT_REASONING_STEP,
                            reasoningContent=event.text,
                            **member_event_kwargs,
                        )
                        await _persist_state()
                        continue

                    if isinstance(event, ReasoningCompleted):
                        _flush_member_reasoning(member_state)
                        emit_chat_event(ch, EVENT_REASONING_COMPLETED, **member_event_kwargs)
                        await _persist_state()
                        continue

                    if isinstance(event, ToolCallStarted) and event.tool is not None:
                        _flush_member_text(member_state)
                        _flush_member_reasoning(member_state)
                        tool_payload = {
                            "id": event.tool.id,
                            "toolName": event.tool.name,
                            "toolArgs": event.tool.arguments,
                            "isCompleted": False,
                            **(
                                {"providerData": event.tool.provider_data}
                                if event.tool.provider_data
                                else {}
                            ),
                        }
                        tool_block = _find_tool_block(member_content, event.tool.id)
                        if tool_block is None:
                            member_content.append({"type": "tool_call", **tool_payload})
                        else:
                            tool_block.update(tool_payload)
                        emit_chat_event(
                            ch,
                            EVENT_TOOL_CALL_STARTED,
                            tool=tool_payload,
                            **member_event_kwargs,
                        )
                        continue

                    if isinstance(event, ToolCallCompleted) and event.tool is not None:
                        tool_block = _find_tool_block(member_content, event.tool.id)
                        tool_args = (
                            tool_block.get("toolArgs")
                            if tool_block is not None and isinstance(tool_block.get("toolArgs"), dict)
                            else None
                        )
                        tool_payload = _build_tool_call_completed_payload(
                            tool_id=event.tool.id,
                            tool_name=event.tool.name,
                            tool_args=tool_args,
                            tool_result=event.tool.result,
                            provider_data=event.tool.provider_data,
                            chat_id=chat_id,
                            failed=bool(event.tool.failed)
                            or _did_tool_call_fail(event.tool.name, event.tool.id),
                        )
                        if tool_block is not None:
                            tool_block.update(tool_payload)
                        emit_chat_event(
                            ch,
                            EVENT_TOOL_CALL_COMPLETED,
                            tool=tool_payload,
                            **member_event_kwargs,
                        )
                        await _persist_state()
                        continue

                    if isinstance(event, RunError):
                        _flush_member_text(member_state)
                        _flush_member_reasoning(member_state)
                        error_msg = extract_error_message(event.message)
                        member_content.append({"type": "error", "content": error_msg})
                        content_blocks[member_state.block_index]["isCompleted"] = True
                        content_blocks[member_state.block_index]["hasError"] = True
                        emit_chat_event(
                            ch,
                            EVENT_MEMBER_RUN_ERROR,
                            content=error_msg,
                            **member_event_kwargs,
                        )
                        member_runs.pop(member_state.run_id, None)
                        await _persist_state()
                        continue

                    if isinstance(event, RunCompleted):
                        continue

                if isinstance(event, RunCancelled):
                    trace_status = "cancelled"
                    _flush_text()
                    _flush_reasoning()
                    await _persist_state(final=True)
                    if not ephemeral:
                        with db.db_session() as sess:
                            db.mark_message_complete(sess, assistant_msg_id)
                    run_control.remove_active_run(assistant_msg_id)
                    run_control.clear_early_cancel(assistant_msg_id)
                    emit_chat_event(ch, EVENT_RUN_CANCELLED)
                    if chat_id:
                        await broadcaster.update_stream_status(chat_id, "completed")
                        await broadcaster.unregister_stream(chat_id)
                    trace_recorder.finish(status=trace_status)
                    return

                if isinstance(event, ContentDelta):
                    if current_reasoning and not current_text:
                        _flush_reasoning()
                    current_text += event.text
                    emit_chat_event(ch, EVENT_RUN_CONTENT, content=event.text)
                    await _persist_state()
                    continue

                if isinstance(event, ToolCallStarted) and event.tool is not None:
                    if _is_delegation_tool(event.tool.name):
                        _flush_text()
                        _flush_reasoning()
                        active_delegation_tool_id = event.tool.id
                        delegation_task = str(event.tool.arguments.get("task") or "")
                        content_blocks.append(
                            {
                                "type": "tool_call",
                                "id": event.tool.id,
                                "toolName": event.tool.name,
                                "toolArgs": event.tool.arguments,
                                "isCompleted": False,
                                "isDelegation": True,
                                **(
                                    {"providerData": event.tool.provider_data}
                                    if event.tool.provider_data
                                    else {}
                                ),
                            }
                        )
                        continue

                    _flush_text()
                    _flush_reasoning()
                    tool_payload = {
                        "id": event.tool.id,
                        "toolName": event.tool.name,
                        "toolArgs": event.tool.arguments,
                        "isCompleted": False,
                        **(
                            {"providerData": event.tool.provider_data}
                            if event.tool.provider_data
                            else {}
                        ),
                    }
                    tool_block = _find_tool_block(content_blocks, event.tool.id)
                    if tool_block is None:
                        content_blocks.append({"type": "tool_call", **tool_payload})
                    else:
                        tool_block.update(tool_payload)
                    emit_chat_event(ch, EVENT_TOOL_CALL_STARTED, tool=tool_payload)
                    continue

                if isinstance(event, ToolCallCompleted) and event.tool is not None:
                    if (
                        active_delegation_tool_id
                        and event.tool.id == active_delegation_tool_id
                        and _is_delegation_tool(event.tool.name)
                    ):
                        _flush_all_member_runs()
                        delegation_block = _find_tool_block(content_blocks, active_delegation_tool_id)
                        if delegation_block is not None:
                            delegation_block["isCompleted"] = True
                            delegation_block["toolResult"] = event.tool.result
                            if bool(event.tool.failed) or _did_tool_call_fail(event.tool.name, event.tool.id):
                                delegation_block["failed"] = True
                        active_delegation_tool_id = None
                        delegation_task = ""
                        await _persist_state(final=True)
                        continue

                    _flush_text()
                    _flush_reasoning()
                    tool_block = _find_tool_block(content_blocks, event.tool.id)
                    tool_args = (
                        tool_block.get("toolArgs")
                        if tool_block is not None and isinstance(tool_block.get("toolArgs"), dict)
                        else None
                    )
                    tool_payload = _build_tool_call_completed_payload(
                        tool_id=event.tool.id,
                        tool_name=event.tool.name,
                        tool_args=tool_args,
                        tool_result=event.tool.result,
                        provider_data=event.tool.provider_data,
                        chat_id=chat_id,
                        failed=bool(event.tool.failed)
                        or _did_tool_call_fail(event.tool.name, event.tool.id),
                    )
                    if tool_block is None:
                        content_blocks.append({"type": "tool_call", **tool_payload})
                    else:
                        tool_block.clear()
                        tool_block.update({"type": "tool_call", **tool_payload})
                    emit_chat_event(ch, EVENT_TOOL_CALL_COMPLETED, tool=tool_payload)
                    await _persist_state(final=True)
                    continue

                if isinstance(event, ReasoningStarted):
                    _flush_text()
                    emit_chat_event(ch, EVENT_REASONING_STARTED)
                    continue

                if isinstance(event, ReasoningDelta):
                    if current_text and not current_reasoning:
                        _flush_text()
                    current_reasoning += event.text
                    emit_chat_event(
                        ch,
                        EVENT_REASONING_STEP,
                        reasoningContent=event.text,
                    )
                    await _persist_state()
                    continue

                if isinstance(event, ReasoningCompleted):
                    _flush_reasoning()
                    emit_chat_event(ch, EVENT_REASONING_COMPLETED)
                    continue

                if isinstance(event, ApprovalRequired):
                    _flush_text()
                    _flush_reasoning()

                    if chat_id:
                        await broadcaster.update_stream_status(chat_id, "paused_hitl")

                    tools_info: list[dict[str, Any]] = []
                    for pending_tool in event.tools:
                        editable_args = pending_tool.editable_args
                        if editable_args is None:
                            editable_args = registry.get_editable_args(pending_tool.tool_name)
                        tool_block = {
                            "type": "tool_call",
                            "id": pending_tool.tool_call_id,
                            "toolName": pending_tool.tool_name,
                            "toolArgs": pending_tool.tool_args,
                            "isCompleted": False,
                            "requiresApproval": True,
                            "approvalStatus": "pending",
                        }
                        content_blocks.append(tool_block)
                        tool_info = {
                            "id": pending_tool.tool_call_id,
                            "toolName": pending_tool.tool_name,
                            "toolArgs": pending_tool.tool_args,
                        }
                        if editable_args:
                            tool_info["editableArgs"] = editable_args
                        tools_info.append(tool_info)

                    await _persist_state()
                    emit_chat_event(
                        ch,
                        EVENT_TOOL_APPROVAL_REQUIRED,
                        tool={"runId": event.run_id, "tools": tools_info},
                    )

                    approval_event = asyncio.Event()
                    if not event.run_id:
                        raise ValueError("Approval required event missing run_id")
                    run_control.register_approval_waiter(event.run_id, approval_event)

                    timed_out = False
                    try:
                        await asyncio.wait_for(approval_event.wait(), timeout=300)
                    except TimeoutError:
                        timed_out = True
                        approval_response = ApprovalResponse(
                            run_id=event.run_id,
                            default_approved=False,
                        )
                    else:
                        response = run_control.get_approval_response(event.run_id)
                        tool_decisions = response.get("tool_decisions", {})
                        edited_args = response.get("edited_args", {})
                        default_approved = response.get("approved", False)
                        decisions: dict[str, ToolDecision] = {}
                        for pending_tool in event.tools:
                            tool_id = pending_tool.tool_call_id
                            approved = tool_decisions.get(tool_id, default_approved)
                            decisions[tool_id] = ToolDecision(
                                approved=approved,
                                edited_args=edited_args.get(tool_id),
                            )
                        approval_response = ApprovalResponse(
                            run_id=event.run_id,
                            decisions=decisions,
                            default_approved=default_approved,
                        )

                    run_control.clear_approval(event.run_id)

                    for pending_tool in event.tools:
                        tool_id = pending_tool.tool_call_id
                        decision = approval_response.decisions.get(tool_id)
                        approved = (
                            decision.approved
                            if decision is not None
                            else approval_response.default_approved
                        )
                        tool_args = (
                            decision.edited_args
                            if decision is not None and decision.edited_args is not None
                            else pending_tool.tool_args
                        )
                        status = "timeout" if timed_out else ("approved" if approved else "denied")
                        tool_block = _find_tool_block(content_blocks, tool_id)
                        if tool_block is not None:
                            tool_block["approvalStatus"] = status
                            tool_block["toolArgs"] = tool_args
                            if status in {"denied", "timeout"}:
                                tool_block["isCompleted"] = True
                        emit_chat_event(
                            ch,
                            EVENT_TOOL_APPROVAL_RESOLVED,
                            tool={
                                "id": tool_id,
                                "approvalStatus": status,
                                "toolArgs": tool_args,
                            },
                        )

                    await _persist_state()
                    if chat_id:
                        await broadcaster.update_stream_status(chat_id, "streaming")
                    response_stream = agent_handle.continue_run(approval_response)
                    break

                if isinstance(event, RunCompleted):
                    trace_status = "completed"
                    _flush_text()
                    _flush_reasoning()
                    await _persist_state(final=True)
                    if not ephemeral:
                        with db.db_session() as sess:
                            db.mark_message_complete(sess, assistant_msg_id)
                    emit_chat_event(ch, EVENT_RUN_COMPLETED)
                    if hasattr(ch, "flush_broadcasts"):
                        await ch.flush_broadcasts()
                    if chat_id:
                        await broadcaster.update_stream_status(chat_id, "completed")
                        await broadcaster.unregister_stream(chat_id)
                    trace_recorder.finish(status=trace_status)
                    return

                if isinstance(event, RunError):
                    _flush_text()
                    _flush_reasoning()
                    error_msg = extract_error_message(event.message)
                    trace_status = "error"
                    trace_error = error_msg
                    content_blocks.append(
                        {
                            "type": "error",
                            "content": error_msg,
                            "timestamp": datetime.now(UTC).isoformat(),
                        }
                    )
                    await _persist_state(final=True)
                    emit_chat_event(ch, EVENT_RUN_ERROR, content=error_msg)
                    had_error = True
                    if hasattr(ch, "flush_broadcasts"):
                        await ch.flush_broadcasts()
                    if chat_id:
                        await broadcaster.update_stream_status(chat_id, "error", error_msg)
                        await broadcaster.unregister_stream(chat_id)
                    run_control.remove_active_run(assistant_msg_id)
                    run_control.clear_early_cancel(assistant_msg_id)
                    trace_recorder.finish(status=trace_status, error_message=trace_error)
                    return
            else:
                break

        if trace_status == "streaming":
            _flush_text()
            _flush_reasoning()
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
                await _persist_state(final=True)
            except Exception as save_err:
                logger.error("[stream] Failed to save state on close: %s", save_err)
            emit_chat_event(ch, EVENT_RUN_ERROR, content=error_msg)
            if chat_id:
                await broadcaster.update_stream_status(chat_id, "error", error_msg)
                await broadcaster.unregister_stream(chat_id)

    except asyncio.CancelledError:
        if run_id:
            run_control.clear_approval(run_id)
        raise
    except Exception as e:
        logger.error("[stream] Exception in stream handler: %s", e)
        _flush_text()
        _flush_reasoning()
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
            await _persist_state(final=True)
        except Exception as save_err:
            logger.error("[stream] Failed to save state on error: %s", save_err)
        emit_chat_event(ch, EVENT_RUN_ERROR, content=error_msg)
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
