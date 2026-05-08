"""Droid Agent node — drives the Factory `droid` CLI via droid-sdk-python.

All runtime config (cwd, model, autonomy, reasoning, mode) is contributed
through `declare_variables` so it surfaces in the chat composer header /
advanced popover, scoped per-node so multiple Droid nodes coexist.
"""

from __future__ import annotations

import asyncio
import logging
import re
import uuid
from collections import deque
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
from droid_sdk.schemas.cli import ToolResultNotification
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

# Process-local session cache so we resume the same droid session across turns
# in the same chat. Keyed by `chat_id:node_id`; lost on backend restart.
_session_cache: dict[str, str] = {}


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
        pending_result_ids: deque[str] = deque()

        def _on_tool_result_notif(notification_dict: dict[str, Any]) -> None:
            try:
                inner = notification_dict.get("params", {}).get("notification", {})
                parsed = ToolResultNotification.model_validate(inner)
            except Exception:
                logger.debug("Failed to parse tool_result notification", exc_info=True)
                return
            pending_result_ids.append(parsed.tool_use_id)

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
                    pending_result_ids=pending_result_ids,
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


_RECOVERABLE_DROID_ERRORS = (DroidConnectionError, DroidTimeoutError)


async def _drain_response_stream(
    *,
    client: DroidClient,
    context: FlowContext,
    queue: asyncio.Queue[Any],
    content_parts: list[str],
    tool_name_by_id: dict[str, str],
    pending_result_ids: deque[str],
) -> None:
    reasoning_open = False

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
                    await queue.put(
                        _agent_event(
                            context,
                            "ToolCallCompleted",
                            tool={
                                "id": tool_id,
                                "toolName": tool_name,
                                "toolResult": msg.content,
                                "failed": bool(msg.is_error),
                            },
                        )
                    )
                    continue

                if isinstance(msg, ToolProgress):
                    tool_id = ""
                    for tid, tname in tool_name_by_id.items():
                        if tname == msg.tool_name:
                            tool_id = tid
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
    request_id = uuid.uuid4().hex
    approval_event = droid_permission_to_approval(
        params, run_id=run_id, request_id=request_id
    )
    await queue.put(_approval_required_node_event(context, approval_event))

    waiter = asyncio.Event()
    run_control.register_approval_waiter(
        run_id, request_id, waiter, owner_run_id=run_id
    )
    try:
        await waiter.wait()
        cancelled = run_control.was_approval_cancelled(run_id, request_id)
        record = run_control.get_approval_response(run_id, request_id)
        resolved = approval_resolved_event(
            run_id=run_id,
            request_id=request_id,
            record=record,
            cancelled=cancelled,
        )
        await queue.put(_approval_resolved_node_event(context, resolved))
        return droid_permission_response(record, cancelled=cancelled)
    finally:
        run_control.clear_approval(run_id, request_id)


async def _handle_ask_user_request(
    params: dict[str, Any],
    *,
    run_id: str,
    context: FlowContext,
    queue: asyncio.Queue[Any],
    question_lookup: dict[str, list[ApprovalQuestion]],
) -> dict[str, Any]:
    request_id = uuid.uuid4().hex
    approval_event = droid_ask_user_to_approval(
        params, run_id=run_id, request_id=request_id
    )
    question_lookup[request_id] = list(approval_event.questions)
    await queue.put(_approval_required_node_event(context, approval_event))

    waiter = asyncio.Event()
    run_control.register_approval_waiter(
        run_id, request_id, waiter, owner_run_id=run_id
    )
    try:
        await waiter.wait()
        cancelled = run_control.was_approval_cancelled(run_id, request_id)
        record = run_control.get_approval_response(run_id, request_id)
        resolved = approval_resolved_event(
            run_id=run_id,
            request_id=request_id,
            record=record,
            cancelled=cancelled,
        )
        await queue.put(_approval_resolved_node_event(context, resolved))
        return droid_ask_user_response(
            record,
            cancelled=cancelled,
            questions=question_lookup.get(request_id, []),
        )
    finally:
        run_control.clear_approval(run_id, request_id)
        question_lookup.pop(request_id, None)


def _approval_required_node_event(context: FlowContext, event: Any) -> NodeEvent:
    return _agent_event(
        context,
        "ApprovalRequired",
        approval={
            "runId": event.run_id,
            "requestId": event.request_id,
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
        },
    )


def _approval_resolved_node_event(context: FlowContext, event: Any) -> NodeEvent:
    return _agent_event(
        context,
        "ApprovalResolved",
        approval={
            "runId": event.run_id,
            "requestId": event.request_id,
            "selectedOption": event.selected_option,
            "answers": [
                {"index": a.index, "answer": a.answer} for a in event.answers
            ],
            "editedArgs": event.edited_args,
            "cancelled": bool(event.cancelled),
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
    session_key = f"{context.chat_id or ''}:{context.node_id}"
    stored = _session_cache.get(session_key)

    if stored:
        try:
            await client.load_session(session_id=stored)
            await _apply_settings(client, model_id, autonomy, reasoning, interaction_mode)
            return stored
        except SessionNotFoundError:
            _session_cache.pop(session_key, None)
        except Exception:
            logger.exception("Failed to resume droid session %s", stored)
            _session_cache.pop(session_key, None)

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
        _session_cache[session_key] = session_id
        return session_id
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
