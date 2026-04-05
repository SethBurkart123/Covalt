from __future__ import annotations

import asyncio
from collections.abc import Iterator
from contextlib import contextmanager
from types import SimpleNamespace
from typing import Any

import pytest

from backend.application.tooling import (
    CancelFlowRunDependencies,
    CancelFlowRunInput,
    execute_cancel_flow_run,
)
from backend.commands import streaming
from backend.services import run_control
from backend.services.chat_stream import FlowRunHandle


class _FakeAgent:
    def __init__(self) -> None:
        self.cancelled_run_ids: list[str] = []

    def cancel(self, run_id: str | None = None) -> None:
        if run_id:
            self.cancelled_run_ids.append(run_id)


class _RequestOnlyHandle:
    def __init__(self) -> None:
        self.requested = 0

    def request_cancel(self) -> None:
        self.requested += 1


class _CancelFlowLogger:
    def __init__(self) -> None:
        self.messages: list[str] = []

    def info(self, message: str) -> None:
        self.messages.append(message)


class _FakeDb:
    @contextmanager
    def db_session(self) -> Iterator[SimpleNamespace]:
        yield SimpleNamespace()

    def mark_message_complete(self, sess: Any, message_id: str) -> None:
        del sess
        self.last_marked_id = message_id


@pytest.mark.asyncio
async def test_respond_to_tool_approval_sets_response_and_signals_waiter() -> None:
    event = asyncio.Event()
    run_control.register_approval_waiter("run-1", event)

    result = await streaming.respond_to_tool_approval(
        streaming.RespondToToolApprovalInput(
            runId="run-1",
            approved=True,
            toolDecisions={"tool-1": True},
            editedArgs={"tool-1": {"query": "covalt"}},
        )
    )

    assert result == {"success": True}
    assert event.is_set() is True
    response = run_control.get_approval_response("run-1")
    assert response["approved"] is True
    assert response["tool_decisions"] == {"tool-1": True}


@pytest.mark.asyncio
async def test_cancel_run_with_run_id_cancels_agent_and_clears_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_agent = _FakeAgent()
    fake_db = _FakeDb()
    monkeypatch.setattr(streaming, "db", fake_db)

    run_control.register_active_run("msg-1", fake_agent)
    run_control.set_active_run_id("msg-1", "run-1")

    result = await streaming.cancel_run(streaming.CancelRunRequest(messageId="msg-1"))

    assert result == {"cancelled": True}
    assert fake_agent.cancelled_run_ids == ["run-1"]
    assert run_control.get_active_run("msg-1") is None
    assert getattr(fake_db, "last_marked_id") == "msg-1"


@pytest.mark.asyncio
async def test_cancel_run_without_run_id_marks_early_cancel(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_agent = _FakeAgent()
    fake_db = _FakeDb()
    monkeypatch.setattr(streaming, "db", fake_db)

    run_control.register_active_run("msg-2", fake_agent)

    result = await streaming.cancel_run(streaming.CancelRunRequest(messageId="msg-2"))

    assert result == {"cancelled": True}
    assert run_control.get_active_run("msg-2") == (None, fake_agent)
    assert fake_agent.cancelled_run_ids == []
    assert run_control.consume_early_cancel("msg-2") is True
    assert getattr(fake_db, "last_marked_id") == "msg-2"


@pytest.mark.asyncio
async def test_cancel_run_before_run_id_on_flow_handle_applies_after_late_bind(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_agent = _FakeAgent()
    fake_db = _FakeDb()
    monkeypatch.setattr(streaming, "db", fake_db)

    flow_handle = FlowRunHandle()
    run_control.register_active_run("msg-flow-early", flow_handle)

    result = await streaming.cancel_run(
        streaming.CancelRunRequest(messageId="msg-flow-early")
    )

    assert result == {"cancelled": True}
    assert run_control.get_active_run("msg-flow-early") == (None, flow_handle)

    flow_handle.bind_agent(fake_agent)
    flow_handle.set_run_id("run-flow-early")

    assert fake_agent.cancelled_run_ids == ["run-flow-early"]
    assert run_control.consume_early_cancel("msg-flow-early") is True
    assert getattr(fake_db, "last_marked_id") == "msg-flow-early"


@pytest.mark.asyncio
async def test_cancel_run_without_active_run_marks_early_cancel(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_db = _FakeDb()
    monkeypatch.setattr(streaming, "db", fake_db)

    result = await streaming.cancel_run(streaming.CancelRunRequest(messageId="missing"))

    assert result == {"cancelled": True}
    assert run_control.consume_early_cancel("missing") is True
    assert getattr(fake_db, "last_marked_id") == "missing"


@pytest.mark.asyncio
async def test_cancel_run_with_graph_flow_handle_cancels_bound_agent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_agent = _FakeAgent()
    fake_db = _FakeDb()
    monkeypatch.setattr(streaming, "db", fake_db)

    flow_handle = FlowRunHandle()
    flow_handle.bind_agent(fake_agent)
    run_control.register_active_run("msg-flow", flow_handle)
    run_control.set_active_run_id("msg-flow", "run-flow")

    result = await streaming.cancel_run(
        streaming.CancelRunRequest(messageId="msg-flow")
    )

    assert result == {"cancelled": True}
    assert fake_agent.cancelled_run_ids == ["run-flow"]
    assert run_control.get_active_run("msg-flow") is None


def _cancel_flow_dependencies(logger: _CancelFlowLogger) -> CancelFlowRunDependencies:
    return CancelFlowRunDependencies(
        get_active_run=run_control.get_active_run,
        mark_early_cancel=run_control.mark_early_cancel,
        remove_active_run=run_control.remove_active_run,
        logger=logger,
    )


def test_cancel_flow_run_with_bound_run_id_cancels_and_removes_active_state() -> None:
    logger = _CancelFlowLogger()
    handle = _FakeAgent()
    run_control.register_active_run("flow-run-1", handle)
    run_control.set_active_run_id("flow-run-1", "runtime-1")

    result = execute_cancel_flow_run(
        CancelFlowRunInput(run_id="flow-run-1"),
        _cancel_flow_dependencies(logger),
    )

    assert result == {"cancelled": True}
    assert handle.cancelled_run_ids == ["runtime-1"]
    assert run_control.get_active_run("flow-run-1") is None


def test_cancel_flow_run_without_run_id_marks_early_cancel_and_requests_handle_cancel() -> (
    None
):
    logger = _CancelFlowLogger()
    handle = _RequestOnlyHandle()
    run_control.register_active_run("flow-run-early", handle)

    result = execute_cancel_flow_run(
        CancelFlowRunInput(run_id="flow-run-early"),
        _cancel_flow_dependencies(logger),
    )

    assert result == {"cancelled": True}
    assert handle.requested == 1
    assert run_control.consume_early_cancel("flow-run-early") is True
    assert run_control.get_active_run("flow-run-early") == (None, handle)


def test_cancel_flow_run_without_active_run_returns_false_without_marking_intent() -> None:
    logger = _CancelFlowLogger()

    result = execute_cancel_flow_run(
        CancelFlowRunInput(run_id="missing-flow-run"),
        _cancel_flow_dependencies(logger),
    )

    assert result == {"cancelled": False}
    assert run_control.consume_early_cancel("missing-flow-run") is False
