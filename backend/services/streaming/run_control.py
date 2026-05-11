from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class ToolDecisionRecord:
    selected_option: str
    edited_args: dict[str, Any] | None = None
    cancelled: bool = False


@dataclass(slots=True)
class ApprovalSession:
    run_id: str
    session_id: str
    tool_call_ids: list[str]
    event: asyncio.Event
    owner_run_id: str | None = None
    decisions: dict[str, ToolDecisionRecord] = field(default_factory=dict)
    cancelled: bool = False

    def is_complete(self) -> bool:
        return self.cancelled or all(tid in self.decisions for tid in self.tool_call_ids)


_active_runs: dict[str, tuple[str | None, Any]] = {}
_cancelled_messages: set[str] = set()
_sessions: dict[str, ApprovalSession] = {}
_tool_call_to_session: dict[str, str] = {}
_owner_to_sessions: dict[str, set[str]] = {}


def _apply_cancel_intent(message_id: str, run_id: str | None, agent: Any) -> None:
    if message_id not in _cancelled_messages:
        return

    request_cancel = getattr(agent, "request_cancel", None)
    if callable(request_cancel):
        try:
            request_cancel()
        except Exception:
            pass
        return

    if not run_id:
        return

    cancel = getattr(agent, "cancel", None)
    if callable(cancel):
        try:
            cancel(run_id)
        except Exception:
            pass


def reset_state() -> None:
    _active_runs.clear()
    _cancelled_messages.clear()
    _sessions.clear()
    _tool_call_to_session.clear()
    _owner_to_sessions.clear()


def register_active_run(message_id: str, agent: Any) -> None:
    _active_runs[message_id] = (None, agent)
    _apply_cancel_intent(message_id, None, agent)


def set_active_run_id(message_id: str, run_id: str) -> None:
    existing = _active_runs.get(message_id)
    if existing is None:
        return
    _, agent = existing
    _active_runs[message_id] = (run_id, agent)
    _apply_cancel_intent(message_id, run_id, agent)


def get_active_run(message_id: str) -> tuple[str | None, Any] | None:
    return _active_runs.get(message_id)


def remove_active_run(message_id: str) -> tuple[str | None, Any] | None:
    return _active_runs.pop(message_id, None)


def mark_early_cancel(message_id: str) -> None:
    _cancelled_messages.add(message_id)


def consume_early_cancel(message_id: str) -> bool:
    if message_id not in _cancelled_messages:
        return False
    _cancelled_messages.discard(message_id)
    return True


def clear_early_cancel(message_id: str) -> None:
    _cancelled_messages.discard(message_id)


def register_approval_session(
    run_id: str,
    tool_call_ids: list[str],
    event: asyncio.Event,
    *,
    owner_run_id: str | None = None,
) -> ApprovalSession:
    session_id = uuid.uuid4().hex
    session = ApprovalSession(
        run_id=run_id,
        session_id=session_id,
        tool_call_ids=list(tool_call_ids),
        event=event,
        owner_run_id=owner_run_id,
    )
    _sessions[session_id] = session
    for tool_id in tool_call_ids:
        _tool_call_to_session[tool_id] = session_id
    if owner_run_id:
        _owner_to_sessions.setdefault(owner_run_id, set()).add(session_id)
    return session


def find_session_by_tool_call_id(tool_call_id: str) -> ApprovalSession | None:
    session_id = _tool_call_to_session.get(tool_call_id)
    if session_id is None:
        return None
    return _sessions.get(session_id)


def get_session(session_id: str) -> ApprovalSession | None:
    return _sessions.get(session_id)


def record_tool_decision(
    tool_call_id: str,
    *,
    selected_option: str,
    edited_args: dict[str, Any] | None = None,
    cancelled: bool = False,
) -> bool:
    session = find_session_by_tool_call_id(tool_call_id)
    if session is None:
        return False
    if cancelled:
        session.cancelled = True

    # A session represents one HITL decision covering a set of tool_call_ids.
    # Recording a decision for any tool call applies to the whole session.
    record = ToolDecisionRecord(
        selected_option=selected_option,
        edited_args=edited_args,
        cancelled=cancelled,
    )
    for tid in session.tool_call_ids:
        session.decisions[tid] = record
    if session.is_complete():
        session.event.set()
    return True


def clear_session(session: ApprovalSession) -> None:
    _sessions.pop(session.session_id, None)
    for tool_id in session.tool_call_ids:
        if _tool_call_to_session.get(tool_id) == session.session_id:
            _tool_call_to_session.pop(tool_id, None)
    if session.owner_run_id:
        owners = _owner_to_sessions.get(session.owner_run_id)
        if owners is not None:
            owners.discard(session.session_id)
            if not owners:
                _owner_to_sessions.pop(session.owner_run_id, None)


def cancel_sessions_for_run(run_id: str) -> bool:
    target_ids: set[str] = set(_owner_to_sessions.get(run_id, set()))
    target_ids.update(
        session_id for session_id, session in _sessions.items() if session.run_id == run_id
    )
    woke_any = False
    for session_id in target_ids:
        session = _sessions.get(session_id)
        if session is None:
            continue
        session.cancelled = True
        session.event.set()
        woke_any = True
    return woke_any
