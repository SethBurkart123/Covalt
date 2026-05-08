"""Droid Agent node — drives the Factory `droid` CLI via droid-sdk-python.

All runtime config (cwd, model, autonomy, reasoning, mode) is contributed
through `declare_variables` so it surfaces in the chat composer header /
advanced popover, scoped per-node so multiple Droid nodes coexist.
"""

from __future__ import annotations

import asyncio
import logging
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
    ToolProgress,
    ToolResult,
    ToolUse,
    TurnComplete,
)
from droid_sdk.schemas.cli import ToolResultNotification
from droid_sdk.schemas.enums import (
    AutonomyLevel,
    DroidInteractionMode,
    ReasoningEffort,
    SessionNotificationType,
)

from nodes._types import DataValue, ExecutionResult, FlowContext, NodeEvent
from nodes._variables import variable_id_suffix
from nodes.core.droid_agent._daemon import resolve_droid_executable

logger = logging.getLogger(__name__)


_REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"]
_AUTONOMY_LEVELS = ["off", "low", "medium", "high"]
_INTERACTION_MODES = ["auto", "spec"]

# Process-local session cache so we resume the same droid session across turns
# in the same chat. Keyed by `chat_id:node_id`; lost on backend restart.
_session_cache: dict[str, str] = {}


class DroidAgentExecutor:
    node_type = "droid-agent"

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
        reasoning_started = False

        def _on_tool_result_notif(notification_dict: dict[str, Any]) -> None:
            try:
                inner = notification_dict.get("params", {}).get("notification", {})
                parsed = ToolResultNotification.model_validate(inner)
            except Exception:
                logger.debug("Failed to parse tool_result notification", exc_info=True)
                return
            pending_result_ids.append(parsed.tool_use_id)

        try:
            await client.connect()
            unsub_result = client.on_notification(
                _on_tool_result_notif,
                notification_type=SessionNotificationType.TOOL_RESULT,
            )

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

            async for msg in client.receive_response():
                if isinstance(msg, AssistantTextDelta):
                    content_parts.append(msg.text)
                    yield NodeEvent(
                        node_id=context.node_id,
                        node_type=self.node_type,
                        event_type="progress",
                        run_id=context.run_id,
                        data={"token": msg.text},
                    )
                    continue

                if isinstance(msg, ThinkingTextDelta):
                    if not reasoning_started:
                        reasoning_started = True
                        yield _agent_event(context, "ReasoningStarted")
                    yield _agent_event(
                        context,
                        "ReasoningStep",
                        reasoningContent=msg.text,
                    )
                    continue

                if isinstance(msg, ToolUse):
                    tool_name_by_id[msg.tool_use_id] = msg.tool_name
                    yield _agent_event(
                        context,
                        "ToolCallStarted",
                        tool={
                            "id": msg.tool_use_id,
                            "toolName": msg.tool_name,
                            "toolArgs": dict(msg.tool_input or {}),
                            "isCompleted": False,
                        },
                    )
                    continue

                if isinstance(msg, ToolResult):
                    tool_id = pending_result_ids.popleft() if pending_result_ids else ""
                    tool_name = (
                        msg.tool_name
                        or (tool_name_by_id.get(tool_id) if tool_id else "")
                        or ""
                    )
                    yield _agent_event(
                        context,
                        "ToolCallCompleted",
                        tool={
                            "id": tool_id,
                            "toolName": tool_name,
                            "toolResult": msg.content,
                            "failed": bool(msg.is_error),
                        },
                    )
                    continue

                if isinstance(msg, ToolProgress):
                    continue

                if isinstance(msg, ErrorEvent):
                    raise RuntimeError(msg.message)

                if isinstance(msg, TurnComplete):
                    if reasoning_started:
                        yield _agent_event(context, "ReasoningCompleted")
                        reasoning_started = False
                    break

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
            unsub = locals().get("unsub_result")
            if callable(unsub):
                with _suppress_errors():
                    unsub()
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
