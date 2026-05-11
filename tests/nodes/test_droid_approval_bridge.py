"""Unit + integration tests for the droid approval bridge.

Covers:
- ``droid_permission_to_approval`` for ``exec``/``edit``/``apply_patch``/``ask_user``.
- ``droid_ask_user_to_approval`` shape.
- ``droid_permission_response`` / ``droid_ask_user_response`` mapping via
  ``ApprovalSession`` decisions.
- The async ``_handle_permission_request`` / ``_handle_ask_user_request``
  end-to-end bridge against ``run_control``.
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import MagicMock

import pytest

from backend.runtime import ApprovalQuestion
from backend.services.streaming import run_control
from backend.services.streaming.run_control import (
    ApprovalSession,
    ToolDecisionRecord,
)
from nodes._types import FlowContext, NodeEvent
from nodes.core.droid_agent._approval_bridge import (
    approval_resolved_event,
    droid_ask_user_response,
    droid_ask_user_to_approval,
    droid_permission_response,
    droid_permission_to_approval,
)
from nodes.core.droid_agent.executor import (
    _handle_ask_user_request,
    _handle_permission_request,
)


def _flow_ctx() -> FlowContext:
    return FlowContext(
        node_id="droid-1",
        chat_id="chat-1",
        run_id="run-droid",
        state=MagicMock(),
        runtime=None,
        services=None,
    )


def _make_session(
    run_id: str,
    tool_call_ids: list[str],
    decisions: dict[str, ToolDecisionRecord] | None = None,
    *,
    cancelled: bool = False,
) -> ApprovalSession:
    return ApprovalSession(
        run_id=run_id,
        session_id="session-test",
        tool_call_ids=list(tool_call_ids),
        event=asyncio.Event(),
        decisions=dict(decisions or {}),
        cancelled=cancelled,
    )


@pytest.fixture(autouse=True)
def _reset_run_control() -> None:
    run_control.reset_state()
    yield
    run_control.reset_state()


class TestDroidPermissionToApproval:
    def test_exec_emits_command_editable_and_summary(self) -> None:
        params: dict[str, Any] = {
            "toolUses": [
                {
                    "toolUse": {
                        "type": "tool_use",
                        "id": "tu-1",
                        "name": "execute",
                        "input": {"command": "ls -la"},
                    },
                    "confirmationType": "exec",
                    "details": {
                        "type": "exec",
                        "fullCommand": "ls -la",
                        "command": "ls",
                        "impactLevel": "low",
                    },
                }
            ],
            "options": [
                {"value": "proceed_once", "label": "Allow"},
                {"value": "cancel", "label": "Deny"},
            ],
        }

        event, pending_tools = droid_permission_to_approval(params, run_id="run-droid")

        assert event.kind == "tool_approval"
        assert event.tool_use_ids == ["tu-1"]
        assert event.tool_name == "execute"
        assert event.summary == "Run command: ls -la"
        assert event.risk_level == "low"

        editable_paths = [list(e.path) for e in event.editable]
        assert ["command"] in editable_paths

        option_values = [opt.value for opt in event.options]
        assert "proceed_once" in option_values
        assert "cancel" in option_values

        assert pending_tools[0]["id"] == "tu-1"
        assert pending_tools[0]["toolArgs"] == {"command": "ls -la"}

    def test_edit_marks_new_str_as_editable(self) -> None:
        params: dict[str, Any] = {
            "toolUses": [
                {
                    "toolUse": {
                        "type": "tool_use",
                        "id": "tu-2",
                        "name": "edit",
                        "input": {
                            "file_path": "/tmp/foo.py",
                            "old_str": "x",
                            "new_str": "y",
                        },
                    },
                    "confirmationType": "edit",
                    "details": {
                        "type": "edit",
                        "filePath": "/tmp/foo.py",
                        "fileName": "foo.py",
                        "oldContent": "x",
                        "newContent": "y",
                    },
                }
            ],
            "options": [],
        }

        event, _ = droid_permission_to_approval(params, run_id="run-droid")

        assert event.summary == "Edit /tmp/foo.py"
        editable_paths = [list(e.path) for e in event.editable]
        assert ["new_str"] in editable_paths

    def test_apply_patch_marks_patch_editable(self) -> None:
        params: dict[str, Any] = {
            "toolUses": [
                {
                    "toolUse": {
                        "type": "tool_use",
                        "id": "tu-3",
                        "name": "apply_patch",
                        "input": {"patch": "diff --git ..."},
                    },
                    "confirmationType": "apply_patch",
                    "details": {
                        "type": "apply_patch",
                        "filePath": "/tmp/foo.py",
                        "fileName": "foo.py",
                        "patchContent": "diff --git ...",
                    },
                }
            ],
            "options": [],
        }

        event, _ = droid_permission_to_approval(params, run_id="run-droid")

        editable_paths = [list(e.path) for e in event.editable]
        assert ["patch"] in editable_paths

    def test_falls_back_to_default_options_when_none_provided(self) -> None:
        params: dict[str, Any] = {
            "toolUses": [
                {
                    "toolUse": {
                        "type": "tool_use",
                        "id": "tu-4",
                        "name": "execute",
                        "input": {"command": "id"},
                    },
                    "confirmationType": "exec",
                    "details": {"type": "exec", "fullCommand": "id", "command": "id"},
                }
            ],
            "options": [],
        }

        event, _ = droid_permission_to_approval(params, run_id="run-droid")

        option_values = {opt.value for opt in event.options}
        assert "proceed_once" in option_values
        assert "cancel" in option_values


class TestDroidAskUserToApproval:
    def test_questions_translate_to_approval_questions(self) -> None:
        params: dict[str, Any] = {
            "toolCallId": "tu-99",
            "questions": [
                {
                    "index": 1,
                    "topic": "Project name",
                    "question": "What is the name?",
                    "options": ["Foo", "Bar"],
                },
                {
                    "index": 2,
                    "topic": "Description",
                    "question": "Describe it",
                    "options": [],
                },
            ],
        }

        event, pending_tools = droid_ask_user_to_approval(params, run_id="run-droid")

        assert event.kind == "user_input"
        assert pending_tools[0]["toolName"] == "ask_user"
        assert pending_tools[0]["id"] == "tu-99"
        assert event.tool_use_ids == ["tu-99"]
        assert len(event.questions) == 2
        assert event.questions[0].topic == "Project name"
        assert event.questions[0].options == ["Foo", "Bar"]
        assert event.questions[1].index == 2

        roles = {opt.role for opt in event.options}
        assert "abort" in roles
        assert next(opt for opt in event.options if opt.value == "submit").requires_input is True


class TestDroidResponseMapping:
    def test_permission_response_returns_cancel_on_cancelled_session(self) -> None:
        session = _make_session("run", ["tu-1"], cancelled=True)
        assert droid_permission_response(session) == "cancel"

    def test_permission_response_returns_cancel_on_missing_decision(self) -> None:
        session = _make_session("run", ["tu-1"])
        assert droid_permission_response(session) == "cancel"

    def test_permission_response_returns_selected_option_verbatim(self) -> None:
        session = _make_session(
            "run",
            ["tu-1"],
            {"tu-1": ToolDecisionRecord(selected_option="proceed_once")},
        )
        assert droid_permission_response(session) == "proceed_once"

    def test_ask_user_response_returns_cancelled_when_cancelled(self) -> None:
        session = _make_session("run", ["askuser:1"], cancelled=True)
        result = droid_ask_user_response(session, questions=[])
        assert result == {"cancelled": True, "answers": []}

    def test_ask_user_response_returns_cancelled_on_cancel_option(self) -> None:
        session = _make_session(
            "run",
            ["askuser:1"],
            {"askuser:1": ToolDecisionRecord(selected_option="cancel")},
        )
        result = droid_ask_user_response(session, questions=[])
        assert result == {"cancelled": True, "answers": []}

    def test_ask_user_response_emits_answers_with_questions(self) -> None:
        session = _make_session(
            "run",
            ["askuser:1"],
            {
                "askuser:1": ToolDecisionRecord(
                    selected_option="submit",
                    edited_args={
                        "answers": [
                            {"index": 1, "answer": "Foo"},
                            {"index": 2, "answer": "It rocks"},
                        ]
                    },
                )
            },
        )
        questions = [
            ApprovalQuestion(index=1, topic="A", question="What is name?"),
            ApprovalQuestion(index=2, topic="B", question="Describe"),
        ]
        result = droid_ask_user_response(session, questions=questions)
        assert result["cancelled"] is False
        assert result["answers"] == [
            {"index": 1, "question": "What is name?", "answer": "Foo"},
            {"index": 2, "question": "Describe", "answer": "It rocks"},
        ]


class TestApprovalResolvedEvent:
    def test_cancelled_returns_cancel_resolved_event(self) -> None:
        session = _make_session("r", ["tu-1"], cancelled=True)
        pending = [{"id": "tu-1", "toolName": "execute", "toolArgs": {}}]
        event, resolved_tools = approval_resolved_event(
            run_id="r", session=session, pending_tools=pending
        )
        assert event.cancelled is True
        assert event.selected_option == "cancel"
        assert resolved_tools[0]["approvalStatus"] == "denied"

    def test_resolved_event_carries_edits(self) -> None:
        session = _make_session(
            "r",
            ["tu-1"],
            {
                "tu-1": ToolDecisionRecord(
                    selected_option="proceed_edit",
                    edited_args={"command": "ls"},
                )
            },
        )
        pending = [{"id": "tu-1", "toolName": "execute", "toolArgs": {"command": "id"}}]
        event, resolved_tools = approval_resolved_event(
            run_id="r", session=session, pending_tools=pending
        )
        assert event.cancelled is False
        assert event.selected_option == "proceed_edit"
        assert event.edited_args == {"command": "ls"}
        assert resolved_tools[0]["approvalStatus"] == "approved"
        assert resolved_tools[0]["toolArgs"] == {"command": "ls"}


@pytest.mark.asyncio
class TestPermissionHandlerBridge:
    async def test_handler_emits_required_resolves_and_returns_decision(self) -> None:
        ctx = _flow_ctx()
        queue: asyncio.Queue[Any] = asyncio.Queue()
        params: dict[str, Any] = {
            "toolUses": [
                {
                    "toolUse": {
                        "type": "tool_use",
                        "id": "tu-1",
                        "name": "execute",
                        "input": {"command": "ls"},
                    },
                    "confirmationType": "exec",
                    "details": {
                        "type": "exec",
                        "fullCommand": "ls",
                        "command": "ls",
                    },
                }
            ],
            "options": [{"value": "proceed_once", "label": "Allow"}],
        }

        async def _auto_resolve() -> None:
            for _ in range(200):
                if run_control.find_session_by_tool_call_id("tu-1") is not None:
                    run_control.record_tool_decision(
                        "tu-1", selected_option="proceed_once"
                    )
                    return
                await asyncio.sleep(0.005)
            raise AssertionError("session never registered")

        handler_task = asyncio.create_task(
            _handle_permission_request(
                params,
                run_id="run-droid",
                context=ctx,
                queue=queue,
            )
        )
        await _auto_resolve()
        result = await asyncio.wait_for(handler_task, timeout=2.0)

        assert result == "proceed_once"

        events: list[NodeEvent] = []
        while not queue.empty():
            events.append(queue.get_nowait())

        names = [
            ev.data["event"]
            for ev in events
            if isinstance(ev, NodeEvent) and isinstance(ev.data, dict)
        ]
        assert "ApprovalRequired" in names
        assert "ApprovalResolved" in names

    async def test_handler_returns_cancel_on_cancellation(self) -> None:
        ctx = _flow_ctx()
        queue: asyncio.Queue[Any] = asyncio.Queue()
        params: dict[str, Any] = {
            "toolUses": [
                {
                    "toolUse": {
                        "type": "tool_use",
                        "id": "tu-2",
                        "name": "execute",
                        "input": {"command": "ls"},
                    },
                    "confirmationType": "exec",
                    "details": {"type": "exec", "fullCommand": "ls", "command": "ls"},
                }
            ],
            "options": [],
        }

        async def _cancel_after_register() -> None:
            for _ in range(200):
                if run_control.find_session_by_tool_call_id("tu-2") is not None:
                    run_control.cancel_sessions_for_run("run-droid")
                    return
                await asyncio.sleep(0.005)
            raise AssertionError("session never registered")

        handler_task = asyncio.create_task(
            _handle_permission_request(
                params, run_id="run-droid", context=ctx, queue=queue
            )
        )
        await _cancel_after_register()
        result = await asyncio.wait_for(handler_task, timeout=2.0)

        assert result == "cancel"


@pytest.mark.asyncio
class TestAskUserHandlerBridge:
    async def test_handler_returns_answers_dict(self) -> None:
        ctx = _flow_ctx()
        queue: asyncio.Queue[Any] = asyncio.Queue()
        question_lookup: dict[str, list[ApprovalQuestion]] = {}
        params: dict[str, Any] = {
            "toolCallId": "tu-99",
            "questions": [
                {
                    "index": 1,
                    "topic": "Name",
                    "question": "What name?",
                    "options": [],
                }
            ],
        }

        async def _auto_answer() -> None:
            for _ in range(200):
                if question_lookup:
                    run_control.record_tool_decision(
                        "tu-99",
                        selected_option="submit",
                        edited_args={"answers": [{"index": 1, "answer": "Covalt"}]},
                    )
                    return
                await asyncio.sleep(0.005)
            raise AssertionError("session never registered")

        handler_task = asyncio.create_task(
            _handle_ask_user_request(
                params,
                run_id="run-droid",
                context=ctx,
                queue=queue,
                question_lookup=question_lookup,
            )
        )
        await _auto_answer()
        result = await asyncio.wait_for(handler_task, timeout=2.0)

        assert result == {
            "cancelled": False,
            "answers": [{"index": 1, "question": "What name?", "answer": "Covalt"}],
        }
