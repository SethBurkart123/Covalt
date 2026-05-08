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


def test_approval_response_signals_waiter() -> None:
    waiter = asyncio.Event()
    run_control.register_approval_waiter("run-approve", "req-1", waiter)

    run_control.set_approval_response(
        "run-approve",
        "req-1",
        selected_option="approve",
        answers=[(0, "yes")],
        edited_args={"query": "covalt"},
    )

    assert waiter.is_set() is True
    record = run_control.get_approval_response("run-approve", "req-1")
    assert record is not None
    assert record.selected_option == "approve"
    assert record.answers == [(0, "yes")]
    assert record.edited_args == {"query": "covalt"}
    assert record.cancelled is False

    run_control.clear_approval("run-approve", "req-1")
    assert run_control.get_approval_waiter("run-approve", "req-1") is None
    assert run_control.get_approval_response("run-approve", "req-1") is None


def test_cancel_approval_waiter_wakes_waiter_and_marks_cancelled() -> None:
    waiter = asyncio.Event()
    run_control.register_approval_waiter("run-cancel", "req-c", waiter)

    assert run_control.cancel_approval_waiter("run-cancel") is True
    assert waiter.is_set() is True
    assert run_control.was_approval_cancelled("run-cancel", "req-c") is True

    run_control.clear_approval("run-cancel", "req-c")
    assert run_control.was_approval_cancelled("run-cancel", "req-c") is False


def test_cancel_approval_waiter_without_registered_waiter_is_noop() -> None:
    assert run_control.cancel_approval_waiter("missing-run") is False
    assert run_control.was_approval_cancelled("missing-run", "missing-req") is False


def test_cancel_approval_waiter_wakes_subagent_via_owner_run_id() -> None:
    waiter = asyncio.Event()
    run_control.register_approval_waiter(
        "sub-run", "req-sub", waiter, owner_run_id="team-run"
    )

    assert run_control.cancel_approval_waiter("team-run") is True
    assert waiter.is_set() is True
    assert run_control.was_approval_cancelled("sub-run", "req-sub") is True

    run_control.clear_approval("sub-run", "req-sub")
    assert run_control.was_approval_cancelled("sub-run", "req-sub") is False


def test_two_waiters_under_same_run_id_resolve_independently() -> None:
    waiter_a = asyncio.Event()
    waiter_b = asyncio.Event()
    run_control.register_approval_waiter("run-multi", "req-a", waiter_a)
    run_control.register_approval_waiter("run-multi", "req-b", waiter_b)

    run_control.set_approval_response(
        "run-multi",
        "req-a",
        selected_option="approve",
    )

    assert waiter_a.is_set() is True
    assert waiter_b.is_set() is False

    record_a = run_control.get_approval_response("run-multi", "req-a")
    assert record_a is not None
    assert record_a.selected_option == "approve"
    assert run_control.get_approval_response("run-multi", "req-b") is None


def test_cancel_approval_waiter_wakes_all_pending_requests_for_run() -> None:
    waiter_a = asyncio.Event()
    waiter_b = asyncio.Event()
    run_control.register_approval_waiter("run-multi", "req-a", waiter_a)
    run_control.register_approval_waiter("run-multi", "req-b", waiter_b)

    assert run_control.cancel_approval_waiter("run-multi") is True
    assert waiter_a.is_set() is True
    assert waiter_b.is_set() is True
    assert run_control.was_approval_cancelled("run-multi", "req-a") is True
    assert run_control.was_approval_cancelled("run-multi", "req-b") is True


def test_set_approval_response_is_idempotent() -> None:
    waiter = asyncio.Event()
    run_control.register_approval_waiter("run-idem", "req-1", waiter)

    run_control.set_approval_response(
        "run-idem", "req-1", selected_option="approve"
    )
    run_control.set_approval_response(
        "run-idem", "req-1", selected_option="deny"
    )

    record = run_control.get_approval_response("run-idem", "req-1")
    assert record is not None
    assert record.selected_option == "deny"
    assert waiter.is_set() is True


def test_clear_approval_only_removes_named_request() -> None:
    waiter_a = asyncio.Event()
    waiter_b = asyncio.Event()
    run_control.register_approval_waiter("run-clear", "req-a", waiter_a)
    run_control.register_approval_waiter("run-clear", "req-b", waiter_b)

    run_control.set_approval_response(
        "run-clear", "req-a", selected_option="approve"
    )
    run_control.set_approval_response(
        "run-clear", "req-b", selected_option="deny"
    )

    run_control.clear_approval("run-clear", "req-a")

    assert run_control.get_approval_response("run-clear", "req-a") is None
    record_b = run_control.get_approval_response("run-clear", "req-b")
    assert record_b is not None
    assert record_b.selected_option == "deny"


def test_reset_state_clears_all_approval_state() -> None:
    waiter = asyncio.Event()
    run_control.register_approval_waiter(
        "run-reset", "req", waiter, owner_run_id="owner"
    )
    run_control.set_approval_response(
        "run-reset", "req", selected_option="approve"
    )
    run_control.cancel_approval_waiter("run-reset")

    run_control.reset_state()

    assert run_control.get_approval_waiter("run-reset", "req") is None
    assert run_control.get_approval_response("run-reset", "req") is None
    assert run_control.was_approval_cancelled("run-reset", "req") is False
    assert run_control.cancel_approval_waiter("owner") is False
