from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

ApprovalKey = tuple[str, str]


@dataclass(slots=True)
class ApprovalResponseRecord:
    selected_option: str
    answers: list[tuple[int, str]] = field(default_factory=list)
    edited_args: dict[str, Any] | None = None
    cancelled: bool = False


_active_runs: dict[str, tuple[str | None, Any]] = {}
_cancelled_messages: set[str] = set()
_approval_events: dict[ApprovalKey, asyncio.Event] = {}
_approval_responses: dict[ApprovalKey, ApprovalResponseRecord] = {}
_cancelled_approvals: set[ApprovalKey] = set()
_approval_owners: dict[str, set[ApprovalKey]] = {}


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
    _approval_events.clear()
    _approval_responses.clear()
    _cancelled_approvals.clear()
    _approval_owners.clear()


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


def register_approval_waiter(
    run_id: str,
    request_id: str,
    event: asyncio.Event,
    *,
    owner_run_id: str | None = None,
) -> None:
    key: ApprovalKey = (run_id, request_id)
    _approval_events[key] = event
    if owner_run_id:
        _approval_owners.setdefault(owner_run_id, set()).add(key)


def get_approval_waiter(run_id: str, request_id: str) -> asyncio.Event | None:
    return _approval_events.get((run_id, request_id))


def set_approval_response(
    run_id: str,
    request_id: str,
    *,
    selected_option: str,
    answers: list[tuple[int, str]] | None = None,
    edited_args: dict[str, Any] | None = None,
    cancelled: bool = False,
) -> None:
    key: ApprovalKey = (run_id, request_id)
    _approval_responses[key] = ApprovalResponseRecord(
        selected_option=selected_option,
        answers=list(answers) if answers else [],
        edited_args=edited_args,
        cancelled=cancelled,
    )
    event = _approval_events.get(key)
    if event is not None:
        event.set()


def get_approval_response(run_id: str, request_id: str) -> ApprovalResponseRecord | None:
    return _approval_responses.get((run_id, request_id))


def clear_approval(run_id: str, request_id: str) -> None:
    key: ApprovalKey = (run_id, request_id)
    _approval_events.pop(key, None)
    _approval_responses.pop(key, None)
    _cancelled_approvals.discard(key)
    for waiters in _approval_owners.values():
        waiters.discard(key)


def cancel_approval_waiter(run_id: str) -> bool:
    targets: set[ApprovalKey] = set(_approval_owners.get(run_id, set()))
    targets.update(key for key in _approval_events if key[0] == run_id)

    woke_any = False
    for key in targets:
        event = _approval_events.get(key)
        if event is None:
            continue
        _cancelled_approvals.add(key)
        event.set()
        woke_any = True
    return woke_any


def was_approval_cancelled(run_id: str, request_id: str) -> bool:
    return (run_id, request_id) in _cancelled_approvals
