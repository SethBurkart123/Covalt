from __future__ import annotations

import asyncio

import pytest

from backend.services.streaming import run_control


@pytest.fixture(autouse=True)
def _reset_run_control_state():
    run_control.reset_state()
    yield
    run_control.reset_state()


class _RequestCancelableHandle:
    def __init__(self) -> None:
        self.requested = 0

    def request_cancel(self) -> None:
        self.requested += 1


class _RunIdCancelableHandle:
    def __init__(self) -> None:
        self.cancelled_run_ids: list[str] = []

    def cancel(self, run_id: str | None = None) -> None:
        if run_id:
            self.cancelled_run_ids.append(run_id)


def test_active_run_lifecycle() -> None:
    agent = object()
    run_control.register_active_run("msg-1", agent)
    assert run_control.get_active_run("msg-1") == (None, agent)

    run_control.set_active_run_id("msg-1", "run-1")
    assert run_control.get_active_run("msg-1") == ("run-1", agent)

    assert run_control.remove_active_run("msg-1") == ("run-1", agent)
    assert run_control.get_active_run("msg-1") is None


def test_early_cancel_consumption() -> None:
    run_control.mark_early_cancel("msg-2")
    assert run_control.consume_early_cancel("msg-2") is True
    assert run_control.consume_early_cancel("msg-2") is False


def test_register_active_run_applies_pending_cancel_intent_to_request_handle() -> None:
    handle = _RequestCancelableHandle()
    run_control.mark_early_cancel("msg-3")

    run_control.register_active_run("msg-3", handle)

    assert handle.requested == 1
    assert run_control.consume_early_cancel("msg-3") is True


def test_set_active_run_id_applies_pending_cancel_intent_to_run_id_handle() -> None:
    handle = _RunIdCancelableHandle()
    run_control.mark_early_cancel("msg-4")

    run_control.register_active_run("msg-4", handle)
    run_control.set_active_run_id("msg-4", "run-4")

    assert handle.cancelled_run_ids == ["run-4"]
    assert run_control.consume_early_cancel("msg-4") is True


def test_session_fires_when_first_decision_recorded() -> None:
    waiter = asyncio.Event()
    session = run_control.register_approval_session(
        "run-1", ["tu-a", "tu-b"], waiter
    )

    assert run_control.find_session_by_tool_call_id("tu-a") is session
    assert run_control.find_session_by_tool_call_id("tu-b") is session

    assert (
        run_control.record_tool_decision("tu-a", selected_option="allow_once") is True
    )
    assert waiter.is_set() is True

    assert session.decisions["tu-a"].selected_option == "allow_once"
    assert session.decisions["tu-b"].selected_option == "allow_once"
    assert session.cancelled is False


def test_session_fires_immediately_on_cancel_decision() -> None:
    waiter = asyncio.Event()
    session = run_control.register_approval_session(
        "run-2", ["tu-x", "tu-y"], waiter
    )

    assert (
        run_control.record_tool_decision("tu-x", selected_option="cancel", cancelled=True)
        is True
    )
    assert waiter.is_set() is True
    assert session.cancelled is True


def test_record_tool_decision_returns_false_when_unknown() -> None:
    assert (
        run_control.record_tool_decision("ghost", selected_option="allow_once") is False
    )


def test_clear_session_removes_indices() -> None:
    waiter = asyncio.Event()
    session = run_control.register_approval_session(
        "run-3", ["tu-1"], waiter, owner_run_id="owner-3"
    )
    run_control.clear_session(session)

    assert run_control.find_session_by_tool_call_id("tu-1") is None
    assert run_control.get_session(session.session_id) is None


def test_cancel_sessions_for_run_wakes_all_owned_sessions() -> None:
    waiter_a = asyncio.Event()
    waiter_b = asyncio.Event()
    sa = run_control.register_approval_session("run-cancel", ["tu-a"], waiter_a)
    sb = run_control.register_approval_session(
        "sub-run", ["tu-b"], waiter_b, owner_run_id="run-cancel"
    )

    assert run_control.cancel_sessions_for_run("run-cancel") is True
    assert waiter_a.is_set() is True
    assert waiter_b.is_set() is True
    assert sa.cancelled is True
    assert sb.cancelled is True


def test_cancel_sessions_for_run_without_session_is_noop() -> None:
    assert run_control.cancel_sessions_for_run("missing-run") is False


def test_two_sessions_under_same_run_resolve_independently() -> None:
    waiter_a = asyncio.Event()
    waiter_b = asyncio.Event()
    run_control.register_approval_session("run-multi", ["tu-1"], waiter_a)
    run_control.register_approval_session("run-multi", ["tu-2"], waiter_b)

    run_control.record_tool_decision("tu-1", selected_option="allow_once")

    assert waiter_a.is_set() is True
    assert waiter_b.is_set() is False


def test_reset_state_clears_all_session_state() -> None:
    waiter = asyncio.Event()
    run_control.register_approval_session(
        "run-reset", ["tu-1"], waiter, owner_run_id="owner"
    )
    run_control.reset_state()

    assert run_control.find_session_by_tool_call_id("tu-1") is None
    assert run_control.cancel_sessions_for_run("owner") is False
