"""Droid Agent node — drives the Factory `droid` CLI via droid-sdk-python.

All runtime config (cwd, model, autonomy, reasoning, mode) is contributed
through `declare_variables` so it surfaces in the chat composer header /
advanced popover, scoped per-node so multiple Droid nodes coexist.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import shutil
import uuid
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from droid_sdk import (
    AssistantTextDelta,
    DroidClient,
    ErrorEvent,
    ProcessTransport,
    SessionNotFoundError,
    ThinkingTextDelta,
    TokenUsageUpdate,
    ToolProgress,
    ToolResult,
    ToolUse,
    TurnComplete,
    WorkingStateChanged,
)
from droid_sdk.errors import (
    ConnectionError as DroidConnectionError,
)
from droid_sdk.errors import (
    TimeoutError as DroidTimeoutError,
)
from droid_sdk.schemas.cli import ToolProgressUpdateNotification, ToolResultNotification
from droid_sdk.schemas.enums import (
    AutonomyLevel,
    DroidInteractionMode,
    ReasoningEffort,
    SessionNotificationType,
)

from backend.runtime import ApprovalQuestion
from backend.services.streaming import run_control
from nodes._types import DataValue, ExecutionResult, FlowContext, NodeEvent
from nodes._variables import variable_id_suffix
from nodes.core.droid_agent._approval_bridge import (
    approval_resolved_event,
    droid_ask_user_response,
    droid_ask_user_to_approval,
    droid_permission_response,
    droid_permission_to_approval,
)
from nodes.core.droid_agent._daemon import resolve_droid_executable

logger = logging.getLogger(__name__)


_STREAM_DONE = object()


_REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"]
_AUTONOMY_LEVELS = ["off", "low", "medium", "high"]
_INTERACTION_MODES = ["auto", "spec"]

# Process-local cache for sessions already resolved in this process. Durable
# branch lookup comes from execution traces keyed by message path.
_session_cache: dict[str, str] = {}


@dataclass
class _DroidTaskRun:
    member_run_id: str
    member_name: str
    task: str
    cwd: str
    subagent_session_id: str = ""
    pending_tool_ids: deque[str] = field(default_factory=deque)
    tool_args_by_id: dict[str, dict[str, Any]] = field(default_factory=dict)
    tool_name_by_id: dict[str, str] = field(default_factory=dict)
    completed_session_indices: set[int] = field(default_factory=set)
    tool_counter: int = 0
    completed_child_count: int = 0
    last_text: str = ""


@dataclass(frozen=True)
class _DroidSessionPlan:
    cache_key: str
    current_session_id: str | None = None
    source_session_id: str | None = None
    source_line_count: int | None = None


@dataclass(frozen=True)
class _DroidSessionCheckpoint:
    session_id: str
    line_count: int | None = None


class DroidAgentExecutor:
    node_type = "droid-agent"

    default_renderers = {
        re.compile(r"^execute$", re.IGNORECASE): "terminal",
        re.compile(r"^edit$", re.IGNORECASE): "file-diff",
        re.compile(r"^create$", re.IGNORECASE): "file-diff",
        re.compile(r"^apply.?patch$", re.IGNORECASE): "patch-diff",
        re.compile(r"^read$", re.IGNORECASE): "file-read",
        re.compile(r"^web.?search$", re.IGNORECASE): "web-search",
        re.compile(r"^todo.?write$", re.IGNORECASE): "todo-list",
    }

    def declare_variables(
        self,
        data: dict[str, Any],
        context: FlowContext | None = None,
    ) -> list[dict[str, Any]]:
        del context
        suffix = variable_id_suffix(str(data.get("name") or "droid"))
        section = str(data.get("name") or "Droid")
        return [
            {
                "id": f"droid_cwd_{suffix}",
                "label": "Working folder",
                "section": section,
                "control": {"kind": "text", "placeholder": "/absolute/path/to/repo"},
                "default": str(data.get("cwd") or Path.home()),
                "required": True,
                "placement": "header",
            },
            {
                "id": f"droid_model_{suffix}",
                "label": "Model",
                "section": section,
                "control": {"kind": "searchable", "grouped": True},
                "options": {"kind": "callback", "load": "droid:models"},
                "default": str(data.get("model") or ""),
                "placement": "header",
            },
            {
                "id": f"droid_autonomy_{suffix}",
                "label": "Autonomy",
                "section": section,
                "control": {"kind": "select"},
                "options": {
                    "kind": "static",
                    "options": [
                        {"value": v, "label": v.title()} for v in _AUTONOMY_LEVELS
                    ],
                },
                "default": "medium",
                "placement": "header",
            },
            {
                "id": f"droid_reasoning_{suffix}",
                "label": "Reasoning",
                "section": section,
                "control": {"kind": "select"},
                "options": {
                    "kind": "static",
                    "options": [
                        {"value": v, "label": _reasoning_label(v)}
                        for v in _REASONING_EFFORTS
                    ],
                },
                "default": "medium",
                "placement": "advanced",
            },
            {
                "id": f"droid_mode_{suffix}",
                "label": "Mode",
                "section": section,
                "control": {"kind": "select"},
                "options": {
                    "kind": "static",
                    "options": [
                        {"value": v, "label": v.title()} for v in _INTERACTION_MODES
                    ],
                },
                "default": "auto",
                "placement": "advanced",
            },
        ]

    async def execute(
        self,
        data: dict[str, Any],
        inputs: dict[str, DataValue],
        context: FlowContext,
    ):
        droid_path = resolve_droid_executable()
        if droid_path is None:
            yield NodeEvent(
                node_id=context.node_id,
                node_type=self.node_type,
                event_type="error",
                run_id=context.run_id,
                data={
                    "error": (
                        "Droid CLI not found. Install with: "
                        "curl -fsSL https://app.factory.ai/cli | sh"
                    )
                },
            )
            yield ExecutionResult(
                outputs={"output": DataValue(type="data", value={"response": ""})}
            )
            return

        input_value = _coerce_input_value(inputs.get("input"))
        message = _resolve_message(input_value)
        variables = _coerce_dict(input_value.get("variables"))

        suffix = variable_id_suffix(str(data.get("name") or "droid"))
        cwd = _coerce_str(
            variables.get(f"droid_cwd_{suffix}"),
            data.get("cwd"),
            str(Path.home()),
        )
        model_id = _coerce_str(
            variables.get(f"droid_model_{suffix}"),
            data.get("model"),
        )
        autonomy = _coerce_enum_optional(
            AutonomyLevel, variables.get(f"droid_autonomy_{suffix}")
        )
        reasoning = _coerce_enum_optional(
            ReasoningEffort, variables.get(f"droid_reasoning_{suffix}")
        )
        interaction_mode = _coerce_enum_optional(
            DroidInteractionMode, variables.get(f"droid_mode_{suffix}")
        )

        agent_name = str(data.get("name") or "Droid")

        yield NodeEvent(
            node_id=context.node_id,
            node_type=self.node_type,
            event_type="started",
            run_id=context.run_id,
            data={"agent": agent_name},
        )

        transport = ProcessTransport(exec_path=droid_path, cwd=cwd)
        client = DroidClient(transport=transport)

        cancel_adapter = _DroidCancelAdapter(client)
        run_handle = _get_run_handle(context)
        if run_handle is not None and hasattr(run_handle, "bind_agent"):
            try:
                run_handle.bind_agent(cancel_adapter)
            except Exception:
                logger.debug("Failed to bind droid cancel adapter", exc_info=True)

        content_parts: list[str] = []
        tool_name_by_id: dict[str, str] = {}
        tool_args_by_id: dict[str, dict[str, Any]] = {}
        pending_progress: deque[ToolProgressUpdateNotification] = deque()
        pending_result_ids: deque[str] = deque()

        def _on_tool_result_notif(notification_dict: dict[str, Any]) -> None:
            try:
                inner = notification_dict.get("params", {}).get("notification", {})
                parsed = ToolResultNotification.model_validate(inner)
            except Exception:
                logger.debug("Failed to parse tool_result notification", exc_info=True)
                return
            pending_result_ids.append(parsed.tool_use_id)

        def _on_tool_progress_notif(notification_dict: dict[str, Any]) -> None:
            try:
                inner = notification_dict.get("params", {}).get("notification", {})
                parsed = ToolProgressUpdateNotification.model_validate(inner)
            except Exception:
                logger.debug("Failed to parse tool_progress notification", exc_info=True)
                return
            pending_progress.append(parsed)

        # Queue is the bridge between the SDK response stream and the
        # permission/ask_user handler callbacks: both producers push NodeEvents
        # here and the generator below drains a single ordered stream.
        event_queue: asyncio.Queue[Any] = asyncio.Queue()
        run_id_for_approvals = context.run_id
        pending_question_lookup: dict[str, list[ApprovalQuestion]] = {}
        stream_task: asyncio.Task[None] | None = None

        async def _permission_handler(params: dict[str, Any]) -> str:
            return await _handle_permission_request(
                params,
                run_id=run_id_for_approvals,
                context=context,
                queue=event_queue,
            )

        async def _ask_user_handler(params: dict[str, Any]) -> dict[str, Any]:
            return await _handle_ask_user_request(
                params,
                run_id=run_id_for_approvals,
                context=context,
                queue=event_queue,
                question_lookup=pending_question_lookup,
            )

        try:
            await client.connect()
            unsub_result = client.on_notification(
                _on_tool_result_notif,
                notification_type=SessionNotificationType.TOOL_RESULT,
            )
            unsub_progress = client.on_notification(
                _on_tool_progress_notif,
                notification_type=SessionNotificationType.TOOL_PROGRESS_UPDATE,
            )
            client.set_permission_handler(_permission_handler)
            client.set_ask_user_handler(_ask_user_handler)

            session_id = await _resume_or_initialize_session(
                client,
                context=context,
                cwd=cwd,
                model_id=model_id,
                autonomy=autonomy,
                reasoning=reasoning,
                interaction_mode=interaction_mode,
            )
            if session_id:
                yield NodeEvent(
                    node_id=context.node_id,
                    node_type=self.node_type,
                    event_type="agent_run_id",
                    run_id=context.run_id,
                    data={"run_id": session_id},
                )

            await client.add_user_message(text=message)

            stream_task = asyncio.create_task(
                _drain_response_stream(
                    client=client,
                    context=context,
                    queue=event_queue,
                    content_parts=content_parts,
                    tool_name_by_id=tool_name_by_id,
                    tool_args_by_id=tool_args_by_id,
                    pending_progress=pending_progress,
                    pending_result_ids=pending_result_ids,
                    cwd=cwd,
                )
            )

            while True:
                item = await event_queue.get()
                if item is _STREAM_DONE:
                    break
                if isinstance(item, Exception):
                    raise item
                if isinstance(item, NodeEvent):
                    yield item
                    continue

            if stream_task is not None:
                await stream_task

            if session_id:
                checkpoint = _droid_session_checkpoint_event(
                    context,
                    self.node_type,
                    cwd,
                    session_id,
                )
                if checkpoint is not None:
                    yield checkpoint

            yield ExecutionResult(
                outputs={
                    "output": DataValue(
                        type="data",
                        value={"response": "".join(content_parts)},
                    )
                }
            )

        except asyncio.CancelledError:
            yield NodeEvent(
                node_id=context.node_id,
                node_type=self.node_type,
                event_type="cancelled",
                run_id=context.run_id,
            )
            yield ExecutionResult(
                outputs={"output": DataValue(type="data", value={"response": ""})}
            )
            raise
        except Exception as exc:
            logger.exception("Droid agent run failed")
            yield NodeEvent(
                node_id=context.node_id,
                node_type=self.node_type,
                event_type="error",
                run_id=context.run_id,
                data={"error": str(exc)},
            )
            yield ExecutionResult(
                outputs={"output": DataValue(type="data", value={"response": ""})}
            )
        finally:
            if stream_task is not None and not stream_task.done():
                stream_task.cancel()
                with _suppress_errors():
                    await stream_task
            unsub = locals().get("unsub_result")
            if callable(unsub):
                with _suppress_errors():
                    unsub()
            unsub = locals().get("unsub_progress")
            if callable(unsub):
                with _suppress_errors():
                    unsub()
            with _suppress_errors():
                client.clear_permission_handler()
            with _suppress_errors():
                client.clear_ask_user_handler()
            with _suppress_errors():
                await client.close()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------





def _coerce_input_value(dv: DataValue | None) -> dict[str, Any]:
    if dv is None or dv.value is None:
        return {}
    if isinstance(dv.value, dict):
        return dv.value
    return {"message": str(dv.value)}


def _coerce_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _coerce_str(*candidates: Any) -> str:
    for candidate in candidates:
        if candidate is None:
            continue
        text = str(candidate).strip()
        if text:
            return text
    return ""


def _coerce_enum_optional(enum_cls: type, value: Any) -> Any | None:
    if isinstance(value, enum_cls):
        return value
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return enum_cls(text)
    except ValueError:
        return None


def _resolve_message(input_value: dict[str, Any]) -> str:
    for key in ("message", "last_user_message", "text", "response", "content"):
        candidate = input_value.get(key)
        if candidate is None:
            continue
        if isinstance(candidate, str) and candidate:
            return candidate
        if isinstance(candidate, list):
            joined = "".join(
                block.get("content", "")
                for block in candidate
                if isinstance(block, dict) and block.get("type") == "text"
            )
            if joined:
                return joined
    history = input_value.get("history")
    if isinstance(history, list):
        for entry in reversed(history):
            if isinstance(entry, dict) and entry.get("role") == "user":
                content = entry.get("content")
                if isinstance(content, str) and content:
                    return content
    return ""


def _agent_event(context: FlowContext, event_name: str, **payload: Any) -> NodeEvent:
    return NodeEvent(
        node_id=context.node_id,
        node_type=DroidAgentExecutor.node_type,
        event_type="agent_event",
        run_id=context.run_id,
        data={"event": event_name, **payload},
    )


def _get_run_handle(context: FlowContext) -> Any | None:
    services = context.services
    if services is None:
        return None
    return getattr(services, "run_handle", None)


def _make_tool_call_progress_event(
    context: FlowContext,
    *,
    tool_call_id: str,
    tool_name: str | None,
    detail: str,
    kind: str,
    progress: float | None,
    status: str | None,
) -> NodeEvent:
    payload: dict[str, Any] = {
        "toolCallId": tool_call_id,
        "kind": kind,
        "detail": detail,
    }
    if tool_name:
        payload["toolName"] = tool_name
    if progress is not None:
        payload["progress"] = progress
    if status:
        payload["status"] = status
    return _agent_event(context, "ToolCallProgress", progress=payload)


def _make_working_state_event(context: FlowContext, state: str) -> NodeEvent:
    return _agent_event(context, "WorkingStateChanged", state=state)


def _make_token_usage_event(
    context: FlowContext,
    *,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int,
    cache_write_tokens: int,
    is_message_total: bool = False,
) -> NodeEvent:
    return _agent_event(
        context,
        "TokenUsage",
        tokenUsage={
            "inputTokens": input_tokens,
            "outputTokens": output_tokens,
            "cacheReadTokens": cache_read_tokens,
            "cacheWriteTokens": cache_write_tokens,
            "isMessageTotal": is_message_total,
        },
    )


def _make_stream_warning_event(
    context: FlowContext, *, message: str, level: str = "warning"
) -> NodeEvent:
    return _agent_event(
        context,
        "StreamWarning",
        warning={"message": message, "level": level},
    )


def _is_droid_task_tool(tool_name: str | None) -> bool:
    return str(tool_name or "").strip().lower() == "task"


def _text_arg(args: dict[str, Any], key: str) -> str:
    value = args.get(key)
    return value.strip() if isinstance(value, str) else ""


def _start_task_member_run(
    context: FlowContext,
    *,
    tool_id: str,
    tool_input: dict[str, Any],
    cwd: str,
) -> tuple[_DroidTaskRun, NodeEvent]:
    description = _text_arg(tool_input, "description")
    subagent_type = _text_arg(tool_input, "subagent_type")
    prompt = _text_arg(tool_input, "prompt")
    task_run = _DroidTaskRun(
        member_run_id=f"{context.run_id}:task:{tool_id}",
        member_name=description or subagent_type or "Task",
        task=prompt or description,
        cwd=cwd,
    )
    return task_run, _agent_event(
        context,
        "MemberRunStarted",
        memberRunId=task_run.member_run_id,
        memberName=task_run.member_name,
        task=task_run.task,
        nodeId=context.node_id,
        nodeType=DroidAgentExecutor.node_type,
    )


def _task_member_fields(task_run: _DroidTaskRun) -> dict[str, Any]:
    return {
        "memberRunId": task_run.member_run_id,
        "memberName": task_run.member_name,
        "task": task_run.task,
        "nodeType": DroidAgentExecutor.node_type,
    }


def _coerce_tool_result_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(str(item) for item in content if item is not None)
    return "" if content is None else str(content)


def _tool_key(tool_name: str, tool_args: dict[str, Any]) -> str:
    try:
        args = json.dumps(tool_args, sort_keys=True, separators=(",", ":"))
    except TypeError:
        args = str(tool_args)
    return f"{tool_name.lower()}:{args}"


def _clean_task_text(text: str) -> str:
    lines: list[str] = []
    for line in text.splitlines():
        cleaned = re.sub(r"(?i)\bsession_id:\s*[0-9a-f-]{20,}\b", "", line)
        if cleaned.strip():
            lines.append(cleaned if cleaned == line else cleaned.strip())
    return "\n".join(lines).strip()


def _task_session_id(text: str) -> str:
    match = re.search(r"(?i)\bsession_id:\s*([0-9a-f-]{20,})\b", text)
    return match.group(1) if match else ""


def _is_internal_task_text(text: str) -> bool:
    normalized = text.strip().lower()
    return normalized in {"executing", "subagent session started"}


async def _emit_task_state(
    context: FlowContext,
    queue: asyncio.Queue[Any],
    task_run: _DroidTaskRun,
    state: str,
) -> None:
    if not state:
        return
    await queue.put(
        _agent_event(
            context,
            "WorkingStateChanged",
            state=state,
            **_task_member_fields(task_run),
        )
    )


async def _emit_task_progress(
    context: FlowContext,
    queue: asyncio.Queue[Any],
    task_run: _DroidTaskRun,
    notification: ToolProgressUpdateNotification,
) -> None:
    update = notification.update
    update_type = str(update.type)
    fields = _task_member_fields(task_run)
    if update.subagent_session_id:
        task_run.subagent_session_id = update.subagent_session_id
    else:
        task_run.subagent_session_id = (
            task_run.subagent_session_id
            or _task_session_id(update.text or update.details or "")
        )

    if update_type == "status":
        await _emit_task_state(
            context,
            queue,
            task_run,
            update.status or update.details or update.text or "running",
        )
        return

    if update_type == "message":
        text = _clean_task_text(update.text or update.details or "")
        if text:
            if _is_internal_task_text(text):
                await _emit_task_state(context, queue, task_run, text)
                return
            task_run.last_text = text
            await queue.put(_agent_event(context, "RunContent", content=text, **fields))
        return

    if update_type == "tool_call":
        child_id = f"{task_run.member_run_id}:tool:{task_run.tool_counter}"
        task_run.tool_counter += 1
        tool_args = dict(update.parameters or {})
        task_run.pending_tool_ids.append(child_id)
        task_run.tool_args_by_id[child_id] = tool_args
        task_run.tool_name_by_id[child_id] = update.tool_name or "tool"
        await queue.put(
            _agent_event(
                context,
                "ToolCallStarted",
                tool={
                    "id": child_id,
                    "toolName": update.tool_name or "tool",
                    "toolArgs": tool_args,
                    "isCompleted": False,
                },
                **fields,
            )
        )
        return

    if update_type == "tool_result":
        if task_run.pending_tool_ids:
            child_id = task_run.pending_tool_ids.popleft()
        else:
            child_id = f"{task_run.member_run_id}:tool:{task_run.tool_counter}"
            task_run.tool_counter += 1
        await queue.put(
            _agent_event(
                context,
                "ToolCallCompleted",
                tool={
                    "id": child_id,
                    "toolName": update.tool_name or "tool",
                    "toolArgs": task_run.tool_args_by_id.get(child_id, {}),
                    "toolResult": update.text or update.details or update.value_snippet or "",
                    "failed": False,
                },
                **fields,
            )
        )
        task_run.completed_child_count += 1
        return

    if update_type == "error":
        message = update.error or update.text or update.details or "Task failed"
        await queue.put(_agent_event(context, "MemberRunError", content=message, **fields))


def _session_jsonl_path(cwd: str, session_id: str) -> Path | None:
    if not session_id:
        return None
    root = Path.home() / ".factory" / "sessions"
    direct = root / str(Path(cwd)).replace("/", "-") / f"{session_id}.jsonl"
    if direct.exists():
        return direct
    return next(root.glob(f"*/{session_id}.jsonl"), None) if root.exists() else None


def _task_session_tools(cwd: str, session_id: str) -> list[dict[str, Any]]:
    path = _session_jsonl_path(cwd, session_id)
    if path is None:
        return []

    tools: list[dict[str, Any]] = []
    by_id: dict[str, dict[str, Any]] = {}
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            content = ((item.get("message") or {}).get("content") or [])
            if not isinstance(content, list):
                continue
            for block in content:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "tool_use":
                    tool = {
                        "sessionIndex": len(tools),
                        "toolName": block.get("name") or "tool",
                        "toolArgs": dict(block.get("input") or {}),
                        "toolResult": "",
                        "failed": False,
                        "hasResult": False,
                    }
                    by_id[str(block.get("id") or "")] = tool
                    tools.append(tool)
                elif block.get("type") == "tool_result":
                    tool = by_id.get(str(block.get("tool_use_id") or ""))
                    if tool is not None:
                        tool["toolResult"] = _coerce_tool_result_text(
                            block.get("content")
                        )
                        tool["failed"] = bool(block.get("is_error"))
                        tool["hasResult"] = True
    return [tool for tool in tools if tool["hasResult"]]


def _find_session_tool(
    tools: list[dict[str, Any]],
    task_run: _DroidTaskRun,
    *,
    child_id: str | None = None,
) -> dict[str, Any] | None:
    child_key = None
    if child_id is not None:
        child_key = _tool_key(
            task_run.tool_name_by_id.get(child_id, ""),
            task_run.tool_args_by_id.get(child_id, {}),
        )
    for tool in tools:
        if tool["sessionIndex"] in task_run.completed_session_indices:
            continue
        if child_key and child_key != _tool_key(tool["toolName"], tool["toolArgs"]):
            continue
        return tool
    return None


async def _backfill_task_session_tools(
    context: FlowContext,
    queue: asyncio.Queue[Any],
    task_run: _DroidTaskRun,
    *,
    emit_missing_starts: bool = False,
) -> None:
    tools = _task_session_tools(task_run.cwd, task_run.subagent_session_id)
    if not tools:
        return

    fields = _task_member_fields(task_run)
    while task_run.pending_tool_ids:
        child_id = task_run.pending_tool_ids[0]
        tool = _find_session_tool(tools, task_run, child_id=child_id)
        if tool is None:
            break
        task_run.pending_tool_ids.popleft()
        await queue.put(
            _agent_event(
                context,
                "ToolCallCompleted",
                tool={
                    "id": child_id,
                    "toolName": tool["toolName"],
                    "toolArgs": task_run.tool_args_by_id.get(child_id, tool["toolArgs"]),
                    "toolResult": tool["toolResult"],
                    "failed": tool["failed"],
                },
                **fields,
            )
        )
        task_run.completed_session_indices.add(tool["sessionIndex"])
        task_run.completed_child_count += 1

    if not emit_missing_starts:
        return

    while True:
        tool = _find_session_tool(tools, task_run)
        if tool is None:
            return
        if task_run.pending_tool_ids:
            child_id = task_run.pending_tool_ids.popleft()
        else:
            child_id = f"{task_run.member_run_id}:tool:{task_run.tool_counter}"
            task_run.tool_counter += 1
            task_run.tool_args_by_id[child_id] = dict(tool["toolArgs"])
            task_run.tool_name_by_id[child_id] = tool["toolName"]
            await queue.put(
                _agent_event(
                    context,
                    "ToolCallStarted",
                    tool={
                        "id": child_id,
                        "toolName": tool["toolName"],
                        "toolArgs": tool["toolArgs"],
                        "isCompleted": False,
                    },
                    **fields,
                )
            )
        await queue.put(
            _agent_event(
                context,
                "ToolCallCompleted",
                tool={
                    "id": child_id,
                    "toolName": tool["toolName"],
                    "toolArgs": task_run.tool_args_by_id.get(child_id, tool["toolArgs"]),
                    "toolResult": tool["toolResult"],
                    "failed": tool["failed"],
                },
                **fields,
            )
        )
        task_run.completed_session_indices.add(tool["sessionIndex"])
        task_run.completed_child_count += 1


_RECOVERABLE_DROID_ERRORS = (DroidConnectionError, DroidTimeoutError)


async def _drain_response_stream(
    *,
    client: DroidClient,
    context: FlowContext,
    queue: asyncio.Queue[Any],
    content_parts: list[str],
    tool_name_by_id: dict[str, str],
    tool_args_by_id: dict[str, dict[str, Any]],
    pending_progress: deque[ToolProgressUpdateNotification],
    pending_result_ids: deque[str],
    cwd: str,
) -> None:
    reasoning_open = False
    task_runs: dict[str, _DroidTaskRun] = {}

    async def _close_reasoning_if_open() -> None:
        nonlocal reasoning_open
        if reasoning_open:
            await queue.put(_agent_event(context, "ReasoningCompleted"))
            reasoning_open = False

    while True:
        try:
            async for msg in client.receive_response():
                if isinstance(msg, AssistantTextDelta):
                    await _close_reasoning_if_open()
                    content_parts.append(msg.text)
                    await queue.put(
                        NodeEvent(
                            node_id=context.node_id,
                            node_type=DroidAgentExecutor.node_type,
                            event_type="progress",
                            run_id=context.run_id,
                            data={"token": msg.text},
                        )
                    )
                    continue

                if isinstance(msg, ThinkingTextDelta):
                    if not reasoning_open:
                        reasoning_open = True
                        await queue.put(_agent_event(context, "ReasoningStarted"))
                    await queue.put(
                        _agent_event(context, "ReasoningStep", reasoningContent=msg.text)
                    )
                    continue

                if isinstance(msg, ToolUse):
                    # Reasoning auto-close: any non-thinking event finalizes the
                    # current reasoning block so subsequent tool/text content
                    # renders in its own UI region.
                    await _close_reasoning_if_open()
                    tool_name_by_id[msg.tool_use_id] = msg.tool_name
                    tool_args_by_id[msg.tool_use_id] = dict(msg.tool_input or {})
                    if _is_droid_task_tool(msg.tool_name):
                        task_run, event = _start_task_member_run(
                            context,
                            tool_id=msg.tool_use_id,
                            tool_input=dict(msg.tool_input or {}),
                            cwd=cwd,
                        )
                        task_runs[msg.tool_use_id] = task_run
                        await queue.put(event)
                        continue
                    await queue.put(
                        _agent_event(
                            context,
                            "ToolCallStarted",
                            tool={
                                "id": msg.tool_use_id,
                                "toolName": msg.tool_name,
                                "toolArgs": dict(msg.tool_input or {}),
                                "isCompleted": False,
                            },
                        )
                    )
                    continue

                if isinstance(msg, ToolResult):
                    await _close_reasoning_if_open()
                    tool_id = pending_result_ids.popleft() if pending_result_ids else ""
                    tool_name = (
                        msg.tool_name
                        or (tool_name_by_id.get(tool_id) if tool_id else "")
                        or ""
                    )
                    task_run = task_runs.pop(tool_id, None)
                    if task_run is not None:
                        fields = _task_member_fields(task_run)
                        if msg.is_error:
                            await queue.put(
                                _agent_event(
                                    context,
                                    "MemberRunError",
                                    content=_coerce_tool_result_text(msg.content) or "Task failed",
                                    **fields,
                                )
                            )
                        else:
                            raw_text = _coerce_tool_result_text(msg.content)
                            task_run.subagent_session_id = (
                                task_run.subagent_session_id
                                or _task_session_id(raw_text)
                            )
                            await _backfill_task_session_tools(
                                context, queue, task_run, emit_missing_starts=True
                            )
                            final_text = _clean_task_text(raw_text)
                            if final_text and final_text != task_run.last_text:
                                await queue.put(
                                    _agent_event(
                                        context,
                                        "RunContent",
                                        content=final_text,
                                        **fields,
                                    )
                                )
                            await queue.put(
                                _agent_event(context, "MemberRunCompleted", **fields)
                            )
                        continue
                    await queue.put(
                        _agent_event(
                            context,
                            "ToolCallCompleted",
                            tool={
                                "id": tool_id,
                                "toolName": tool_name,
                                "toolArgs": tool_args_by_id.get(tool_id, {}),
                                "toolResult": msg.content,
                                "failed": bool(msg.is_error),
                            },
                        )
                    )
                    continue

                if isinstance(msg, ToolProgress):
                    notification = pending_progress.popleft() if pending_progress else None
                    tool_id = notification.tool_use_id if notification is not None else ""
                    if not tool_id:
                        for tid, tname in tool_name_by_id.items():
                            if tname == msg.tool_name:
                                tool_id = tid
                                break
                    task_run = task_runs.get(tool_id)
                    if task_run is not None and notification is not None:
                        await _emit_task_progress(context, queue, task_run, notification)
                        await _backfill_task_session_tools(context, queue, task_run)
                        continue
                    await queue.put(
                        _make_tool_call_progress_event(
                            context,
                            tool_call_id=tool_id,
                            tool_name=msg.tool_name,
                            detail=msg.content,
                            kind="status",
                            progress=None,
                            status="running",
                        )
                    )
                    continue

                if isinstance(msg, WorkingStateChanged):
                    state_value = getattr(msg.state, "value", str(msg.state))
                    await queue.put(_make_working_state_event(context, state_value))
                    continue

                if isinstance(msg, TokenUsageUpdate):
                    await queue.put(
                        _make_token_usage_event(
                            context,
                            input_tokens=msg.input_tokens,
                            output_tokens=msg.output_tokens,
                            cache_read_tokens=msg.cache_read_tokens,
                            cache_write_tokens=msg.cache_write_tokens,
                            is_message_total=False,
                        )
                    )
                    continue

                if isinstance(msg, ErrorEvent):
                    raise RuntimeError(msg.message)

                if isinstance(msg, TurnComplete):
                    await _close_reasoning_if_open()
                    if msg.token_usage is not None:
                        tu = msg.token_usage
                        await queue.put(
                            _make_token_usage_event(
                                context,
                                input_tokens=tu.input_tokens,
                                output_tokens=tu.output_tokens,
                                cache_read_tokens=tu.cache_read_tokens,
                                cache_write_tokens=tu.cache_write_tokens,
                                is_message_total=False,
                            )
                        )
                    await queue.put(_STREAM_DONE)
                    return
            await _close_reasoning_if_open()
            await queue.put(_STREAM_DONE)
            return
        except _RECOVERABLE_DROID_ERRORS as exc:
            logger.warning("recoverable droid error, reconnecting: %s", exc)
            await queue.put(
                _make_stream_warning_event(
                    context,
                    message=f"Reconnecting after {type(exc).__name__}: {exc}",
                    level="warning",
                )
            )
            await asyncio.sleep(0.25)
            try:
                await client.connect()
            except Exception:
                logger.exception("Failed to reconnect after recoverable droid error")
                raise
            continue
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await queue.put(exc)
            return


async def _handle_permission_request(
    params: dict[str, Any],
    *,
    run_id: str,
    context: FlowContext,
    queue: asyncio.Queue[Any],
) -> str:
    approval_event, pending_tools = droid_permission_to_approval(params, run_id=run_id)
    await queue.put(
        _approval_required_node_event(context, approval_event, pending_tools)
    )

    waiter = asyncio.Event()
    tool_ids = [str(t.get("id") or "") for t in pending_tools if t.get("id")]
    session = run_control.register_approval_session(
        run_id, tool_ids, waiter, owner_run_id=run_id
    )
    try:
        await waiter.wait()
        resolved, resolved_tools = approval_resolved_event(
            run_id=run_id, session=session, pending_tools=pending_tools
        )
        await queue.put(
            _approval_resolved_node_event(context, resolved, resolved_tools)
        )
        return droid_permission_response(session)
    finally:
        run_control.clear_session(session)


async def _handle_ask_user_request(
    params: dict[str, Any],
    *,
    run_id: str,
    context: FlowContext,
    queue: asyncio.Queue[Any],
    question_lookup: dict[str, list[ApprovalQuestion]],
) -> dict[str, Any]:
    approval_event, pending_tools = droid_ask_user_to_approval(params, run_id=run_id)
    dialog_tool_id = str(pending_tools[0].get("id") or "")
    question_lookup[dialog_tool_id] = list(approval_event.questions)
    await queue.put(
        _approval_required_node_event(context, approval_event, pending_tools)
    )

    waiter = asyncio.Event()
    session = run_control.register_approval_session(
        run_id, [dialog_tool_id], waiter, owner_run_id=run_id
    )
    try:
        await waiter.wait()
        resolved, resolved_tools = approval_resolved_event(
            run_id=run_id, session=session, pending_tools=pending_tools
        )
        await queue.put(
            _approval_resolved_node_event(context, resolved, resolved_tools)
        )
        return droid_ask_user_response(
            session,
            questions=question_lookup.get(dialog_tool_id, []),
        )
    finally:
        run_control.clear_session(session)
        question_lookup.pop(dialog_tool_id, None)


def _approval_required_node_event(
    context: FlowContext,
    event: Any,
    pending_tools: list[dict[str, Any]],
) -> NodeEvent:
    return _agent_event(
        context,
        "ApprovalRequired",
        tool={
            "runId": event.run_id,
            "kind": event.kind,
            "toolUseIds": list(event.tool_use_ids or []),
            "toolName": event.tool_name,
            "riskLevel": event.risk_level,
            "summary": event.summary,
            "options": [
                {
                    "value": opt.value,
                    "label": opt.label,
                    "role": opt.role,
                    "style": opt.style,
                    "requiresInput": opt.requires_input,
                }
                for opt in event.options
            ],
            "questions": [
                {
                    "index": q.index,
                    "topic": q.topic,
                    "question": q.question,
                    "options": list(q.options),
                    "placeholder": q.placeholder,
                    "multiline": q.multiline,
                    "required": q.required,
                }
                for q in event.questions
            ],
            "editable": [
                {
                    "path": list(e.path),
                    "schema": dict(e.schema),
                    "label": e.label,
                }
                for e in event.editable
            ],
            "renderer": event.renderer,
            "config": dict(event.config) if isinstance(event.config, dict) else {},
            "timeoutMs": event.timeout_ms,
            "tools": pending_tools,
        },
    )


def _approval_resolved_node_event(
    context: FlowContext,
    event: Any,
    resolved_tools: list[dict[str, Any]],
) -> NodeEvent:
    return _agent_event(
        context,
        "ApprovalResolved",
        tool={
            "runId": event.run_id,
            "selectedOption": event.selected_option,
            "answers": [
                {"index": a.index, "answer": a.answer} for a in event.answers
            ],
            "editedArgs": event.edited_args,
            "cancelled": bool(event.cancelled),
            "tools": resolved_tools,
        },
    )


async def _resume_or_initialize_session(
    client: DroidClient,
    *,
    context: FlowContext,
    cwd: str,
    model_id: str,
    autonomy: AutonomyLevel | None,
    reasoning: ReasoningEffort | None,
    interaction_mode: DroidInteractionMode | None,
) -> str | None:
    plan = _build_session_plan(context)
    stored = plan.current_session_id or _session_cache.get(plan.cache_key)

    if stored:
        try:
            await client.load_session(session_id=stored)
            await _apply_settings(
                client,
                model_id,
                autonomy,
                reasoning,
                interaction_mode,
            )
            return stored
        except SessionNotFoundError:
            _session_cache.pop(plan.cache_key, None)
        except Exception:
            logger.exception("Failed to resume droid session %s", stored)
            _session_cache.pop(plan.cache_key, None)

    if plan.source_session_id and _conversation_run_mode(context) == "branch":
        forked = _fork_droid_session(
            cwd,
            plan.source_session_id,
            line_count=plan.source_line_count,
        )
        if forked:
            await client.load_session(session_id=forked)
            await _apply_settings(
                client,
                model_id,
                autonomy,
                reasoning,
                interaction_mode,
            )
            _session_cache[plan.cache_key] = forked
            return forked

    init_kwargs: dict[str, Any] = {"machine_id": "covalt", "cwd": cwd}
    if model_id:
        init_kwargs["model_id"] = model_id
    if autonomy is not None:
        init_kwargs["autonomy_level"] = autonomy
    if reasoning is not None:
        init_kwargs["reasoning_effort"] = reasoning
    if interaction_mode is not None:
        init_kwargs["interaction_mode"] = interaction_mode

    result = await client.initialize_session(**init_kwargs)
    session_id = getattr(result, "session_id", None)
    if isinstance(session_id, str) and session_id:
        _session_cache[plan.cache_key] = session_id
        return session_id
    return None


def _build_session_plan(context: FlowContext) -> _DroidSessionPlan:
    current_message_id = _assistant_message_id(context)
    cache_key = _session_cache_key(context, current_message_id)
    current_session_id: str | None = None
    branch_mode = _conversation_run_mode(context) == "branch"

    if current_message_id:
        current_checkpoint = _latest_droid_checkpoint_for_message(
            current_message_id,
            node_id=context.node_id,
            node_type=DroidAgentExecutor.node_type,
        )
        current_session_id = (
            current_checkpoint.session_id if current_checkpoint is not None else None
        )

    for message_id in reversed(_message_path_ids(context)):
        if message_id == current_message_id:
            continue
        source_checkpoint = _latest_droid_checkpoint_for_message(
            message_id,
            node_id=context.node_id,
            node_type=DroidAgentExecutor.node_type,
        )
        if source_checkpoint is not None:
            if not branch_mode and current_session_id is None:
                return _DroidSessionPlan(
                    cache_key=cache_key,
                    current_session_id=source_checkpoint.session_id,
                    source_session_id=source_checkpoint.session_id,
                    source_line_count=source_checkpoint.line_count,
                )
            return _DroidSessionPlan(
                cache_key=cache_key,
                current_session_id=current_session_id,
                source_session_id=source_checkpoint.session_id,
                source_line_count=source_checkpoint.line_count,
            )

    return _DroidSessionPlan(
        cache_key=cache_key,
        current_session_id=current_session_id,
    )


def _assistant_message_id(context: FlowContext) -> str:
    chat_input = _chat_input(context)
    value = getattr(chat_input, "assistant_message_id", "") if chat_input else ""
    return value if isinstance(value, str) else ""


def _message_path_ids(context: FlowContext) -> list[str]:
    chat_input = _chat_input(context)
    value = getattr(chat_input, "message_path_ids", None) if chat_input else None
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str) and item]


def _conversation_run_mode(context: FlowContext) -> str:
    chat_input = _chat_input(context)
    value = getattr(chat_input, "conversation_run_mode", "") if chat_input else ""
    return value if value in {"branch", "continue"} else "continue"


def _droid_session_checkpoint_event(
    context: FlowContext,
    node_type: str,
    cwd: str,
    session_id: str,
) -> NodeEvent | None:
    line_count = _session_jsonl_line_count(cwd, session_id)
    data: dict[str, Any] = {"run_id": session_id}
    if line_count is not None:
        data["session_line_count"] = line_count
    return NodeEvent(
        node_id=context.node_id,
        node_type=node_type,
        event_type="agent_checkpoint",
        run_id=context.run_id,
        data=data,
    )


def _fork_droid_session(
    cwd: str,
    source_session_id: str,
    *,
    line_count: int | None = None,
) -> str | None:
    source_path = _session_jsonl_path(cwd, source_session_id)
    if source_path is None or not source_path.exists():
        return None

    forked_session_id = str(uuid.uuid4())
    forked_path = source_path.with_name(f"{forked_session_id}.jsonl")
    _copy_session_jsonl(
        source_path,
        forked_path,
        forked_session_id,
        line_count=line_count,
    )

    source_settings_path = source_path.with_name(f"{source_session_id}.settings.json")
    if source_settings_path.exists():
        shutil.copy2(
            source_settings_path,
            source_path.with_name(f"{forked_session_id}.settings.json"),
        )

    return forked_session_id


def _copy_session_jsonl(
    source_path: Path,
    forked_path: Path,
    forked_session_id: str,
    *,
    line_count: int | None = None,
) -> None:
    with source_path.open("r", encoding="utf-8") as source:
        with forked_path.open("w", encoding="utf-8") as target:
            for index, line in enumerate(source):
                if line_count is not None and index >= line_count:
                    break
                try:
                    item = json.loads(line)
                except json.JSONDecodeError:
                    target.write(line)
                    continue
                if item.get("type") == "session_start":
                    item["id"] = forked_session_id
                    target.write(json.dumps(item, separators=(",", ":")) + "\n")
                    continue
                target.write(line)


def _session_jsonl_line_count(cwd: str, session_id: str) -> int | None:
    path = _session_jsonl_path(cwd, session_id)
    if path is None or not path.exists():
        return None
    try:
        with path.open("r", encoding="utf-8") as handle:
            return sum(1 for _line in handle)
    except OSError:
        return None


def _chat_input(context: FlowContext) -> Any | None:
    services = context.services
    if services is None:
        return None
    return getattr(services, "chat_input", None)


def _session_cache_key(context: FlowContext, current_message_id: str) -> str:
    if current_message_id:
        branch_key = current_message_id
    else:
        raw_path = "\0".join(_message_path_ids(context))
        branch_key = hashlib.sha256(raw_path.encode()).hexdigest()
    return f"{context.chat_id or ''}:{context.node_id}:{branch_key}"


def _latest_droid_session_for_message(
    message_id: str,
    *,
    node_id: str,
    node_type: str,
) -> str | None:
    if not message_id:
        return None
    try:
        from backend import db  # noqa: PLC0415

        with db.db_session() as sess:
            return db.get_latest_node_run_id_for_message(
                sess,
                message_id=message_id,
                node_id=node_id,
                node_type=node_type,
            )
    except Exception:
        logger.debug(
            "Failed to resolve droid session for message %s", message_id, exc_info=True
        )
    return None


def _latest_droid_checkpoint_for_message(
    message_id: str,
    *,
    node_id: str,
    node_type: str,
) -> _DroidSessionCheckpoint | None:
    if not message_id:
        return None
    try:
        from backend import db  # noqa: PLC0415

        with db.db_session() as sess:
            payload = db.get_latest_node_event_payload_for_message(
                sess,
                message_id=message_id,
                node_id=node_id,
                node_type=node_type,
                event_type="runtime.node.agent_checkpoint",
            )
            if isinstance(payload, dict):
                session_id = payload.get("run_id")
                line_count = payload.get("session_line_count")
                if isinstance(session_id, str) and session_id:
                    return _DroidSessionCheckpoint(
                        session_id=session_id,
                        line_count=line_count if isinstance(line_count, int) else None,
                    )

    except Exception:
        logger.debug(
            "Failed to resolve droid checkpoint for message %s",
            message_id,
            exc_info=True,
        )

    session_id = _latest_droid_session_for_message(
        message_id,
        node_id=node_id,
        node_type=node_type,
    )
    if session_id:
        return _DroidSessionCheckpoint(session_id=session_id)
    return None


async def _apply_settings(
    client: DroidClient,
    model_id: str,
    autonomy: AutonomyLevel | None,
    reasoning: ReasoningEffort | None,
    interaction_mode: DroidInteractionMode | None,
) -> None:
    kwargs: dict[str, Any] = {}
    if model_id:
        kwargs["model_id"] = model_id
    if autonomy is not None:
        kwargs["autonomy_level"] = autonomy
    if reasoning is not None:
        kwargs["reasoning_effort"] = reasoning
    if interaction_mode is not None:
        kwargs["interaction_mode"] = interaction_mode
    if not kwargs:
        return
    try:
        await client.update_session_settings(**kwargs)
    except Exception:
        logger.debug("Failed to update droid session settings", exc_info=True)


class _DroidCancelAdapter:
    """Adapter exposing the AgentHandle cancel surface against a DroidClient."""

    def __init__(self, client: DroidClient) -> None:
        self._client = client
        self._cancel_requested = False

    def cancel(self, run_id: str | None = None) -> None:
        del run_id
        self._cancel_requested = True
        self._fire()

    def request_cancel(self) -> None:
        self._cancel_requested = True
        self._fire()

    def _fire(self) -> None:
        try:
            asyncio.create_task(self._interrupt())
        except RuntimeError:
            # No running loop — best-effort, transport will be closed in finally.
            pass

    async def _interrupt(self) -> None:
        try:
            await self._client.interrupt_session()
        except Exception:
            logger.debug("Droid interrupt_session failed", exc_info=True)


class _suppress_errors:
    def __enter__(self) -> None:
        return None

    def __exit__(self, exc_type, exc, tb) -> bool:
        if exc is not None:
            logger.debug("Suppressed error during droid cleanup", exc_info=(exc_type, exc, tb))
        return True


def _reasoning_label(value: str) -> str:
    if value == "xhigh":
        return "Extra High"
    return value.title()


executor = DroidAgentExecutor()
