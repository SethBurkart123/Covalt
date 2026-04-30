from __future__ import annotations

import copy
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Callable

import orjson

from .runtime_events import (
    EVENT_MEMBER_RUN_COMPLETED,
    EVENT_MEMBER_RUN_ERROR,
    EVENT_MEMBER_RUN_STARTED,
    EVENT_REASONING_COMPLETED,
    EVENT_REASONING_STARTED,
    EVENT_REASONING_STEP,
    EVENT_RUN_CONTENT,
    EVENT_RUN_ERROR,
    EVENT_TOOL_APPROVAL_REQUIRED,
    EVENT_TOOL_APPROVAL_RESOLVED,
    EVENT_TOOL_CALL_COMPLETED,
    EVENT_TOOL_CALL_STARTED,
)


@dataclass
class MemberRunState:
    run_id: str
    name: str
    block_index: int
    current_text: str = ""
    current_reasoning: str = ""


class ContentAccumulator:
    def __init__(self, content_blocks: list[dict[str, Any]] | None = None) -> None:
        self.content_blocks: list[dict[str, Any]] = list(content_blocks or [])
        self.current_text = ""
        self.current_reasoning = ""
        self.member_runs: dict[str, MemberRunState] = {}

    def flush_text(self) -> None:
        if not self.current_text:
            return
        self.content_blocks.append({"type": "text", "content": self.current_text})
        self.current_text = ""

    def flush_reasoning(self, *, is_completed: bool = True) -> None:
        if not self.current_reasoning:
            return
        self.content_blocks.append(
            {
                "type": "reasoning",
                "content": self.current_reasoning,
                "isCompleted": is_completed,
            }
        )
        self.current_reasoning = ""

    def append_text(self, text: str) -> bool:
        if not text:
            return False
        if self.current_reasoning and not self.current_text:
            self.flush_reasoning()
        self.current_text += text
        return True

    def start_reasoning(self) -> None:
        self.flush_text()

    def append_reasoning(self, text: str) -> bool:
        if not text:
            return False
        if self.current_text and not self.current_reasoning:
            self.flush_text()
        self.current_reasoning += text
        return True

    def complete_reasoning(self) -> None:
        self.flush_reasoning()

    def append_error(
        self,
        message: str,
        *,
        traceback_text: str | None = None,
        timestamp: str | None = None,
    ) -> None:
        block: dict[str, Any] = {
            "type": "error",
            "content": message,
            "timestamp": timestamp or datetime.now(UTC).isoformat(),
        }
        if traceback_text:
            block["traceback"] = traceback_text
        self.content_blocks.append(block)

    def find_tool_block(
        self, blocks: list[dict[str, Any]], tool_id: str
    ) -> dict[str, Any] | None:
        for block in blocks:
            if block.get("type") == "tool_call" and block.get("id") == tool_id:
                return block
        return None

    def add_tool_block(
        self, blocks: list[dict[str, Any]], payload: dict[str, Any]
    ) -> dict[str, Any]:
        block = {"type": "tool_call", **payload}
        blocks.append(block)
        return block

    def update_tool_block(
        self,
        blocks: list[dict[str, Any]],
        tool_id: str,
        payload: dict[str, Any],
        *,
        replace: bool = False,
        create: bool = False,
    ) -> dict[str, Any] | None:
        block = self.find_tool_block(blocks, tool_id)
        if block is None:
            if not create:
                return None
            return self.add_tool_block(blocks, payload)
        if replace:
            block.clear()
            block.update({"type": "tool_call", **payload})
            return block
        block.update(payload)
        return block

    def get_or_create_member_state(
        self,
        run_id: str,
        *,
        name: str = "Agent",
        task: str = "",
        node_id: str | None = None,
        node_type: str | None = None,
        group_by_node: bool | None = None,
    ) -> tuple[MemberRunState | None, bool]:
        if not run_id:
            return None, False

        if run_id in self.member_runs:
            member_state = self.member_runs[run_id]
            member_block = self.content_blocks[member_state.block_index]
            if name and name != "Agent":
                member_state.name = name
                member_block["memberName"] = name
            if node_id:
                member_block["nodeId"] = node_id
            if node_type:
                member_block["nodeType"] = node_type
            if group_by_node is not None:
                member_block["groupByNode"] = bool(group_by_node)
            if task and not member_block.get("task"):
                member_block["task"] = task
            return member_state, False

        # Flush any buffered parent text/reasoning so chronological order is preserved
        # when a sub-agent block lands between parent tokens.
        self.flush_text()
        self.flush_reasoning(is_completed=False)
        block = {
            "type": "member_run",
            "runId": run_id,
            "memberName": name,
            "content": [],
            "isCompleted": False,
            "task": task,
        }
        if node_id:
            block["nodeId"] = node_id
        if node_type:
            block["nodeType"] = node_type
        if group_by_node is not None:
            block["groupByNode"] = bool(group_by_node)
        self.content_blocks.append(block)
        member_state = MemberRunState(
            run_id=run_id,
            name=name,
            block_index=len(self.content_blocks) - 1,
        )
        self.member_runs[run_id] = member_state
        return member_state, True

    def get_or_create_flow_member_state(
        self, data: dict[str, Any]
    ) -> tuple[MemberRunState | None, bool]:
        run_id = str(data.get("memberRunId") or "")
        return self.get_or_create_member_state(
            run_id,
            name=str(data.get("memberName") or "Agent"),
            task=str(data.get("task") or ""),
            node_id=str(data.get("nodeId")) if data.get("nodeId") else None,
            node_type=str(data.get("nodeType")) if data.get("nodeType") else None,
            group_by_node=bool(data.get("groupByNode")) if data.get("groupByNode") is not None else None,
        )

    def get_or_create_runtime_member_state(
        self,
        event: Any,
        *,
        task: str = "",
    ) -> tuple[MemberRunState | None, bool]:
        run_id = str(getattr(event, "member_run_id", "") or "")
        return self.get_or_create_member_state(
            run_id,
            name=str(getattr(event, "member_name", "") or "Agent"),
            task=str(getattr(event, "task", None) or task),
        )

    def member_block(self, member_state: MemberRunState) -> dict[str, Any]:
        return self.content_blocks[member_state.block_index]

    def member_content(self, member_state: MemberRunState) -> list[dict[str, Any]]:
        return self.member_block(member_state)["content"]

    def flush_member_text(self, member_state: MemberRunState) -> None:
        if not member_state.current_text:
            return
        self.member_content(member_state).append(
            {"type": "text", "content": member_state.current_text}
        )
        member_state.current_text = ""

    def flush_member_reasoning(
        self, member_state: MemberRunState, *, is_completed: bool = True
    ) -> None:
        if not member_state.current_reasoning:
            return
        self.member_content(member_state).append(
            {
                "type": "reasoning",
                "content": member_state.current_reasoning,
                "isCompleted": is_completed,
            }
        )
        member_state.current_reasoning = ""

    def append_member_text(self, member_state: MemberRunState, text: str) -> bool:
        if not text:
            return False
        if member_state.current_reasoning and not member_state.current_text:
            self.flush_member_reasoning(member_state)
        member_state.current_text += text
        return True

    def start_member_reasoning(self, member_state: MemberRunState) -> None:
        self.flush_member_text(member_state)

    def append_member_reasoning(self, member_state: MemberRunState, text: str) -> bool:
        if not text:
            return False
        if member_state.current_text and not member_state.current_reasoning:
            self.flush_member_text(member_state)
        member_state.current_reasoning += text
        return True

    def complete_member_reasoning(self, member_state: MemberRunState) -> None:
        self.flush_member_reasoning(member_state)

    def complete_member_run(self, member_state: MemberRunState) -> None:
        self.flush_member_text(member_state)
        self.flush_member_reasoning(member_state)
        self.member_block(member_state)["isCompleted"] = True
        self.member_runs.pop(member_state.run_id, None)

    def fail_member_run(self, member_state: MemberRunState, message: str) -> None:
        self.flush_member_text(member_state)
        self.flush_member_reasoning(member_state)
        member_block = self.member_block(member_state)
        self.member_content(member_state).append({"type": "error", "content": message})
        member_block["isCompleted"] = True
        member_block["hasError"] = True
        self.member_runs.pop(member_state.run_id, None)

    def flush_all_member_runs(
        self,
        *,
        on_completed: Callable[[MemberRunState], None] | None = None,
        cancelled: bool = False,
    ) -> None:
        for member_state in list(self.member_runs.values()):
            self.flush_member_text(member_state)
            self.flush_member_reasoning(member_state)
            block = self.member_block(member_state)
            block["isCompleted"] = True
            if cancelled:
                block["cancelled"] = True
            if on_completed is not None:
                on_completed(member_state)
        self.member_runs.clear()

    def serialize(self) -> str:
        temp = copy.deepcopy(self.content_blocks)
        if self.current_text:
            temp.append({"type": "text", "content": self.current_text})
        if self.current_reasoning:
            temp.append(
                {
                    "type": "reasoning",
                    "content": self.current_reasoning,
                    "isCompleted": False,
                }
            )
        for member_state in self.member_runs.values():
            if member_state.block_index >= len(temp):
                continue
            member_block = temp[member_state.block_index]
            if member_block.get("type") != "member_run":
                continue
            member_content = member_block.setdefault("content", [])
            if member_state.current_text:
                member_content.append(
                    {"type": "text", "content": member_state.current_text}
                )
            if member_state.current_reasoning:
                member_content.append(
                    {
                        "type": "reasoning",
                        "content": member_state.current_reasoning,
                        "isCompleted": False,
                    }
                )
        return orjson.dumps(temp).decode()

    def dump_final(self) -> str:
        return orjson.dumps(self.content_blocks).decode()

    def apply_agent_event(self, data: dict[str, Any]) -> bool:
        event_name = str(data.get("event") or "")
        if not event_name:
            return False

        member_state, _created = self.get_or_create_flow_member_state(data)
        if member_state is not None:
            member_content = self.member_content(member_state)

            if event_name == EVENT_RUN_CONTENT:
                return self.append_member_text(
                    member_state,
                    str(data.get("content") or ""),
                )

            if event_name == EVENT_REASONING_STARTED:
                self.start_member_reasoning(member_state)
                return True

            if event_name == EVENT_REASONING_STEP:
                return self.append_member_reasoning(
                    member_state,
                    str(data.get("reasoningContent") or ""),
                )

            if event_name == EVENT_REASONING_COMPLETED:
                self.complete_member_reasoning(member_state)
                return True

            if event_name == EVENT_TOOL_CALL_STARTED:
                tool = data.get("tool") or {}
                tool_id = str(tool.get("id") or "")
                if not tool_id:
                    return False
                provider_data = tool.get("providerData") if isinstance(tool, dict) else None
                if not isinstance(provider_data, dict) or not provider_data:
                    provider_data = None
                self.flush_member_text(member_state)
                self.flush_member_reasoning(member_state)
                tool_block = self.find_tool_block(member_content, tool_id)
                if tool_block is None:
                    self.add_tool_block(
                        member_content,
                        {
                            "id": tool_id,
                            "toolName": tool.get("toolName"),
                            "toolArgs": tool.get("toolArgs"),
                            "isCompleted": False,
                            **({"providerData": provider_data} if provider_data else {}),
                        },
                    )
                else:
                    tool_block["toolName"] = tool.get("toolName") or tool_block.get("toolName")
                    tool_block["toolArgs"] = tool.get("toolArgs") or tool_block.get("toolArgs")
                    tool_block["isCompleted"] = False
                    if provider_data:
                        tool_block["providerData"] = provider_data
                return True

            if event_name == EVENT_TOOL_CALL_COMPLETED:
                tool = data.get("tool") or {}
                tool_id = str(tool.get("id") or "")
                if not tool_id:
                    return False
                tool_block = self.find_tool_block(member_content, tool_id)
                if tool_block is None:
                    return False
                tool_block["isCompleted"] = True
                tool_block["toolResult"] = tool.get("toolResult")
                if bool(tool.get("failed")):
                    tool_block["failed"] = True
                    tool_block.pop("renderPlan", None)
                elif "renderPlan" in tool:
                    tool_block["renderPlan"] = tool.get("renderPlan")
                return True

            if event_name == EVENT_TOOL_APPROVAL_REQUIRED:
                tool_payload = data.get("tool") or {}
                tools = tool_payload.get("tools")
                if not isinstance(tools, list) or not tools:
                    return False
                self.flush_member_text(member_state)
                self.flush_member_reasoning(member_state)
                for tool in tools:
                    if not isinstance(tool, dict):
                        continue
                    self.add_tool_block(
                        member_content,
                        {
                            "id": tool.get("id"),
                            "toolName": tool.get("toolName"),
                            "toolArgs": tool.get("toolArgs"),
                            "isCompleted": False,
                            "requiresApproval": True,
                            "runId": tool_payload.get("runId"),
                            "toolCallId": tool.get("id"),
                            "approvalStatus": "pending",
                            "editableArgs": tool.get("editableArgs"),
                        },
                    )
                return True

            if event_name == EVENT_TOOL_APPROVAL_RESOLVED:
                tool = data.get("tool") or {}
                tool_id = str(tool.get("id") or "")
                if not tool_id:
                    return False
                tool_block = self.find_tool_block(member_content, tool_id)
                if tool_block is None:
                    return False
                status = tool.get("approvalStatus")
                tool_block["approvalStatus"] = status
                if "toolArgs" in tool:
                    tool_block["toolArgs"] = tool.get("toolArgs")
                if status in ("denied", "timeout"):
                    tool_block["isCompleted"] = True
                return True

            if event_name == EVENT_MEMBER_RUN_COMPLETED:
                self.complete_member_run(member_state)
                return True

            if event_name in {EVENT_MEMBER_RUN_ERROR, EVENT_RUN_ERROR}:
                self.fail_member_run(
                    member_state,
                    str(data.get("content") or data.get("error") or "Member run failed"),
                )
                return True

            return event_name == EVENT_MEMBER_RUN_STARTED

        if event_name == EVENT_RUN_CONTENT:
            return self.append_text(str(data.get("content") or ""))

        if event_name == EVENT_REASONING_STARTED:
            self.start_reasoning()
            return True

        if event_name == EVENT_REASONING_STEP:
            return self.append_reasoning(str(data.get("reasoningContent") or ""))

        if event_name == EVENT_REASONING_COMPLETED:
            self.complete_reasoning()
            return True

        if event_name == EVENT_TOOL_CALL_STARTED:
            tool = data.get("tool") or {}
            tool_id = str(tool.get("id") or "")
            if not tool_id:
                return False
            provider_data = tool.get("providerData") if isinstance(tool, dict) else None
            if not isinstance(provider_data, dict) or not provider_data:
                provider_data = None
            self.flush_text()
            self.flush_reasoning()
            tool_block = self.find_tool_block(self.content_blocks, tool_id)
            if tool_block is None:
                self.add_tool_block(
                    self.content_blocks,
                    {
                        "id": tool_id,
                        "toolName": tool.get("toolName"),
                        "toolArgs": tool.get("toolArgs"),
                        "isCompleted": False,
                        **({"providerData": provider_data} if provider_data else {}),
                    },
                )
            else:
                tool_block["isCompleted"] = False
                if provider_data:
                    tool_block["providerData"] = provider_data
            return True

        if event_name == EVENT_TOOL_CALL_COMPLETED:
            tool = data.get("tool") or {}
            tool_id = str(tool.get("id") or "")
            if not tool_id:
                return False
            tool_block = self.find_tool_block(self.content_blocks, tool_id)
            if tool_block is None:
                return False
            tool_block["isCompleted"] = True
            tool_block["toolResult"] = tool.get("toolResult")
            if "renderPlan" in tool:
                tool_block["renderPlan"] = tool.get("renderPlan")
            provider_data = tool.get("providerData") if isinstance(tool, dict) else None
            if isinstance(provider_data, dict) and provider_data:
                tool_block["providerData"] = provider_data
            return True

        if event_name == EVENT_TOOL_APPROVAL_REQUIRED:
            tool_payload = data.get("tool") or {}
            tools = tool_payload.get("tools")
            if not isinstance(tools, list) or not tools:
                return False
            self.flush_text()
            self.flush_reasoning()
            for tool in tools:
                if not isinstance(tool, dict):
                    continue
                self.add_tool_block(
                    self.content_blocks,
                    {
                        "id": tool.get("id"),
                        "toolName": tool.get("toolName"),
                        "toolArgs": tool.get("toolArgs"),
                        "isCompleted": False,
                        "requiresApproval": True,
                        "runId": tool_payload.get("runId"),
                        "toolCallId": tool.get("id"),
                        "approvalStatus": "pending",
                        "editableArgs": tool.get("editableArgs"),
                    },
                )
            return True

        if event_name == EVENT_TOOL_APPROVAL_RESOLVED:
            tool = data.get("tool") or {}
            tool_id = str(tool.get("id") or "")
            if not tool_id:
                return False
            tool_block = self.find_tool_block(self.content_blocks, tool_id)
            if tool_block is None:
                return False
            status = tool.get("approvalStatus")
            tool_block["approvalStatus"] = status
            if "toolArgs" in tool:
                tool_block["toolArgs"] = tool.get("toolArgs")
            if status in ("denied", "timeout"):
                tool_block["isCompleted"] = True
            return True

        return False
