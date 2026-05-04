from __future__ import annotations

from backend.runtime import RuntimeToolCall, RuntimeToolResult
from backend.services.tools import tool_registry
from nodes.core.agent.executor import (
    _tool_payload_from_runtime_call,
    _tool_payload_from_runtime_result,
)


def test_tool_payloads_use_original_tool_name() -> None:
    tool_registry._tool_name_restore_map["toolset_create_quiz"] = "toolset:create_quiz"
    try:
        started = _tool_payload_from_runtime_call(
            RuntimeToolCall(
                id="call-1",
                name="toolset_create_quiz",
                arguments={"title": "Quiz"},
            )
        )
        completed = _tool_payload_from_runtime_result(
            RuntimeToolResult(
                id="call-1",
                name="toolset_create_quiz",
                result='{"title": "Quiz"}',
            )
        )
    finally:
        tool_registry._tool_name_restore_map.pop("toolset_create_quiz", None)

    assert started is not None
    assert completed is not None
    assert started["toolName"] == "toolset:create_quiz"
    assert completed["toolName"] == "toolset:create_quiz"
