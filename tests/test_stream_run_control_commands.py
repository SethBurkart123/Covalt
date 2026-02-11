from __future__ import annotations

import asyncio
from contextlib import contextmanager
from types import SimpleNamespace
from typing import Any, Iterator

import pytest

from backend.commands import streaming
from backend.services.chat_graph_runner import FlowRunHandle
from backend.services import run_control


class _FakeAgent:
    def __init__(self) -> None:
        self.cancelled_run_ids: list[str] = []

    def cancel_run(self, run_id: str) -> None:
        self.cancelled_run_ids.append(run_id)


class _FakeDb:
    @contextmanager
    def db_session(self) -> Iterator[SimpleNamespace]:
        yield SimpleNamespace()

    def mark_message_complete(self, sess: Any, message_id: str) -> None:
        del sess
        self.last_marked_id = message_id


@pytest.fixture(autouse=True)
def _reset_run_control() -> None:
    run_control.reset_state()


@pytest.mark.asyncio
async def test_respond_to_tool_approval_sets_response_and_signals_waiter() -> None:
    event = asyncio.Event()
    run_control.register_approval_waiter("run-1", event)

    result = await streaming.respond_to_tool_approval(
        streaming.RespondToToolApprovalInput(
            runId="run-1",
            approved=True,
            toolDecisions={"tool-1": True},
            editedArgs={"tool-1": {"query": "agno"}},
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
    assert run_control.get_active_run("msg-2") is None
    assert run_control.consume_early_cancel("msg-2") is True
    assert getattr(fake_db, "last_marked_id") == "msg-2"


@pytest.mark.asyncio
async def test_cancel_run_without_active_run_returns_false() -> None:
    result = await streaming.cancel_run(streaming.CancelRunRequest(messageId="missing"))
    assert result == {"cancelled": False}


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
