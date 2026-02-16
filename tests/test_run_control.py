from __future__ import annotations

import asyncio

from backend.services import run_control


class _RequestCancelableHandle:
    def __init__(self) -> None:
        self.requested = 0

    def request_cancel(self) -> None:
        self.requested += 1


class _RunIdCancelableHandle:
    def __init__(self) -> None:
        self.cancelled_run_ids: list[str] = []

    def cancel_run(self, run_id: str) -> None:
        self.cancelled_run_ids.append(run_id)


def test_active_run_lifecycle() -> None:
    run_control.reset_state()

    agent = object()
    run_control.register_active_run("msg-1", agent)
    assert run_control.get_active_run("msg-1") == (None, agent)

    run_control.set_active_run_id("msg-1", "run-1")
    assert run_control.get_active_run("msg-1") == ("run-1", agent)

    assert run_control.remove_active_run("msg-1") == ("run-1", agent)
    assert run_control.get_active_run("msg-1") is None


def test_early_cancel_consumption() -> None:
    run_control.reset_state()

    run_control.mark_early_cancel("msg-2")
    assert run_control.consume_early_cancel("msg-2") is True
    assert run_control.consume_early_cancel("msg-2") is False


def test_register_active_run_applies_pending_cancel_intent_to_request_handle() -> None:
    run_control.reset_state()

    handle = _RequestCancelableHandle()
    run_control.mark_early_cancel("msg-3")

    run_control.register_active_run("msg-3", handle)

    assert handle.requested == 1
    assert run_control.consume_early_cancel("msg-3") is True


def test_set_active_run_id_applies_pending_cancel_intent_to_run_id_handle() -> None:
    run_control.reset_state()

    handle = _RunIdCancelableHandle()
    run_control.mark_early_cancel("msg-4")

    run_control.register_active_run("msg-4", handle)
    run_control.set_active_run_id("msg-4", "run-4")

    assert handle.cancelled_run_ids == ["run-4"]
    assert run_control.consume_early_cancel("msg-4") is True


def test_approval_response_signals_waiter() -> None:
    run_control.reset_state()

    waiter = asyncio.Event()
    run_control.register_approval_waiter("run-approve", waiter)

    run_control.set_approval_response(
        "run-approve",
        approved=True,
        tool_decisions={"tool-1": True},
        edited_args={"tool-1": {"x": 1}},
    )

    assert waiter.is_set() is True
    response = run_control.get_approval_response("run-approve")
    assert response["approved"] is True
    assert response["tool_decisions"] == {"tool-1": True}
    assert response["edited_args"] == {"tool-1": {"x": 1}}

    run_control.clear_approval("run-approve")
    assert run_control.get_approval_waiter("run-approve") is None
    assert run_control.get_approval_response("run-approve") == {}
