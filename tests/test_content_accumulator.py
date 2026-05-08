from __future__ import annotations

from backend.services.streaming.chat_stream import _fail_inflight_tool_calls
from backend.services.streaming.content_accumulator import ContentAccumulator
from backend.services.streaming.runtime_events import (
    EVENT_APPROVAL_REQUIRED,
    EVENT_REASONING_STARTED,
    EVENT_REASONING_STEP,
    EVENT_TOOL_CALL_STARTED,
)


def test_member_run_creation_flushes_pending_parent_reasoning_in_order() -> None:
    """When a sub-agent block is added mid-stream, parent reasoning must keep its
    chronological position rather than being flushed at the end."""
    acc = ContentAccumulator()

    # Parent agent starts reasoning ("Thinking" block in the UI)
    acc.apply_agent_event({"event": EVENT_REASONING_STARTED})
    acc.apply_agent_event(
        {"event": EVENT_REASONING_STEP, "reasoningContent": "let me delegate"}
    )

    # Sub-agent emits a HITL approval before parent reasoning has finished
    acc.apply_agent_event(
        {
            "event": EVENT_APPROVAL_REQUIRED,
            "memberRunId": "sub-1",
            "memberName": "Researcher",
            "tool": {
                "runId": "sub-1",
                "tools": [
                    {
                        "id": "tool-1",
                        "toolName": "search",
                        "toolArgs": {"q": "agno"},
                    }
                ],
            },
        }
    )

    # Cancellation flushes everything
    acc.flush_text()
    acc.flush_reasoning()
    acc.flush_all_member_runs()

    types_in_order = [block.get("type") for block in acc.content_blocks]
    assert types_in_order == ["reasoning", "member_run"], types_in_order


def test_fail_inflight_tool_calls_marks_running_tools_failed_with_message() -> None:
    acc = ContentAccumulator()

    acc.apply_agent_event(
        {
            "event": EVENT_TOOL_CALL_STARTED,
            "tool": {"id": "tool-1", "toolName": "search", "toolArgs": {"q": "x"}},
        }
    )
    acc.apply_agent_event(
        {
            "event": EVENT_TOOL_CALL_STARTED,
            "memberRunId": "sub-1",
            "memberName": "Sub",
            "tool": {"id": "tool-2", "toolName": "fetch", "toolArgs": {}},
        }
    )
    # Pending HITL approvals should NOT be touched by this helper.
    acc.apply_agent_event(
        {
            "event": EVENT_APPROVAL_REQUIRED,
            "tool": {
                "runId": "run-x",
                "tools": [{"id": "tool-3", "toolName": "exec", "toolArgs": {}}],
            },
        }
    )

    affected = _fail_inflight_tool_calls(acc.content_blocks)

    affected_ids = sorted(block.get("id") for block in affected)
    assert affected_ids == ["tool-1", "tool-2"]
    for block in affected:
        assert block["isCompleted"] is True
        assert block["failed"] is True
        assert block["toolResult"] == "Cancelled by user"

    # Pending HITL tool block is left alone.
    pending = [
        b
        for b in acc.content_blocks
        if b.get("type") == "tool_call" and b.get("approvalStatus") == "pending"
    ]
    assert len(pending) == 1
    assert pending[0].get("failed") is not True
