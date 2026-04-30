from __future__ import annotations

import asyncio
from typing import Any

_active_runs: dict[str, tuple[str | None, Any]] = {}
_cancelled_messages: set[str] = set()
_approval_events: dict[str, asyncio.Event] = {}
_approval_responses: dict[str, dict[str, Any]] = {}
_cancelled_approvals: set[str] = set()
# owner_run_id (flow run id) -> set of approval run_ids registered under it
_approval_owners: dict[str, set[str]] = {}


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
    event: asyncio.Event,
    *,
    owner_run_id: str | None = None,
) -> None:
    _approval_events[run_id] = event
    if owner_run_id:
        _approval_owners.setdefault(owner_run_id, set()).add(run_id)


def get_approval_waiter(run_id: str) -> asyncio.Event | None:
    return _approval_events.get(run_id)


def set_approval_response(
    run_id: str,
    *,
    approved: bool,
    tool_decisions: dict[str, bool],
    edited_args: dict[str, dict[str, Any]],
) -> None:
    _approval_responses[run_id] = {
        "approved": approved,
        "tool_decisions": tool_decisions,
        "edited_args": edited_args,
    }
    event = _approval_events.get(run_id)
    if event is not None:
        event.set()


def get_approval_response(run_id: str) -> dict[str, Any]:
    return _approval_responses.get(run_id, {})


def clear_approval(run_id: str) -> None:
    _approval_events.pop(run_id, None)
    _approval_responses.pop(run_id, None)
    _cancelled_approvals.discard(run_id)
    for waiters in _approval_owners.values():
        waiters.discard(run_id)


def cancel_approval_waiter(run_id: str) -> bool:
    """Wake every HITL approval waiter associated with `run_id` (treating it as either
    the approval run id itself or the owning flow/team run id). Returns True if at least
    one waiter was signalled."""
    targets = {run_id} | _approval_owners.get(run_id, set())
    woke_any = False
    for target in targets:
        event = _approval_events.get(target)
        if event is None:
            continue
        _cancelled_approvals.add(target)
        event.set()
        woke_any = True
    return woke_any


def was_approval_cancelled(run_id: str) -> bool:
    return run_id in _cancelled_approvals
