from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Any, cast

from agno.agent import Agent, Message
from agno.db.in_memory import InMemoryDb
from agno.models.response import ToolExecution
from agno.run.agent import BaseAgentRunEvent, RunEvent, RunOutputEvent
from agno.run.team import BaseTeamRunEvent

from backend.services.tool_registry import get_original_tool_name

from .protocol import AgentHandle
from .types import (
    AgentConfig,
    ApprovalRequired,
    ApprovalResolved,
    ApprovalResponse,
    ContentDelta,
    ModelUsage,
    PendingApproval,
    ReasoningCompleted,
    ReasoningDelta,
    ReasoningStarted,
    RunCancelled,
    RunCompleted,
    RunError,
    RunStarted,
    RuntimeAttachment,
    RuntimeEventT,
    RuntimeMessage,
    RuntimeToolCall,
    RuntimeToolResult,
    ToolCallCompleted,
    ToolCallStarted,
)


class AgnoAgentHandle(AgentHandle):
    def __init__(
        self,
        agent: Any,
        *,
        member_name: str | None = None,
        task: str | None = None,
        on_event: Callable[[RuntimeEventT], None] | None = None,
    ) -> None:
        self._agent = agent
        self._latest_tools: dict[str, ToolExecution] = {}
        self._active_run_id: str | None = None
        self._member_name = member_name
        self._task = task
        self._on_event = on_event
        self._cancel_requested = False
        self._saw_team_events = False

    async def run(
        self,
        messages: list[RuntimeMessage],
        *,
        add_history_to_context: bool = True,
    ) -> AsyncIterator[RuntimeEventT]:
        agno_messages = [message for runtime in messages for message in _to_agno_messages(runtime)]
        stream = self._agent.arun(
            input=agno_messages,
            add_history_to_context=add_history_to_context,
            stream=True,
            stream_events=True,
        )
        async for event in stream:
            translated = self._translate_event(event)
            if translated is None:
                continue
            if self._on_event is not None:
                self._on_event(translated)
            yield translated

    async def continue_run(
        self,
        approval: ApprovalResponse,
    ) -> AsyncIterator[RuntimeEventT]:
        updated_tools = self._apply_approval(approval)
        stream = self._agent.acontinue_run(
            run_id=approval.run_id,
            updated_tools=updated_tools,
            stream=True,
            stream_events=True,
        )
        async for event in stream:
            translated = self._translate_event(event)
            if translated is None:
                continue
            if self._on_event is not None:
                self._on_event(translated)
            yield translated

    def cancel(self, run_id: str | None = None) -> None:
        self._cancel_requested = True
        target = run_id or self._active_run_id
        if target:
            self._agent.cancel_run(target)

    def request_cancel(self) -> None:
        self._cancel_requested = True
        target = self._active_run_id
        if target:
            self._agent.cancel_run(target)

    def _apply_approval(self, approval: ApprovalResponse) -> list[ToolExecution]:
        updated_tools: list[ToolExecution] = []
        for tool_id, tool in list(self._latest_tools.items()):
            decision = approval.decisions.get(tool_id)
            approved = approval.default_approved
            if decision is not None:
                approved = decision.approved
            tool.confirmed = approved
            if decision is not None and decision.edited_args is not None:
                tool.tool_args = decision.edited_args
            if decision is not None and decision.user_input:
                tool.tool_args = {**(tool.tool_args or {}), **decision.user_input}
            updated_tools.append(tool)
        return updated_tools

    def _translate_event(self, event: RunOutputEvent) -> RuntimeEventT | None:
        event_name = _event_name(getattr(event, "event", None))
        if isinstance(event, BaseTeamRunEvent):
            self._saw_team_events = True
        run_id = str(getattr(event, "run_id", "") or "") or None
        if run_id:
            self._active_run_id = run_id

        is_member_event = isinstance(event, BaseAgentRunEvent) and (
            self._member_name is not None or self._saw_team_events
        )
        member_run_id = run_id if is_member_event else None
        member_name = self._member_name
        if is_member_event and member_name is None:
            raw_member_name = getattr(event, "agent_name", None)
            member_name = str(raw_member_name) if raw_member_name else None

        if event_name == RunEvent.run_started.value:
            return RunStarted(
                run_id=run_id,
                member_run_id=member_run_id,
                member_name=member_name,
                task=self._task,
            )

        if event_name == RunEvent.run_content.value:
            reasoning_content = str(getattr(event, "reasoning_content", "") or "")
            if reasoning_content:
                return ReasoningDelta(
                    run_id=run_id,
                    member_run_id=member_run_id,
                    member_name=member_name,
                    task=self._task,
                    text=reasoning_content,
                )
            content = str(getattr(event, "content", "") or "")
            if content:
                return ContentDelta(
                    run_id=run_id,
                    member_run_id=member_run_id,
                    member_name=member_name,
                    task=self._task,
                    text=content,
                )
            return None

        if event_name == RunEvent.reasoning_started.value:
            return ReasoningStarted(
                run_id=run_id,
                member_run_id=member_run_id,
                member_name=member_name,
                task=self._task,
            )

        if event_name in {RunEvent.reasoning_step.value, RunEvent.reasoning_content_delta.value}:
            text = str(getattr(event, "reasoning_content", "") or "")
            if not text:
                return None
            return ReasoningDelta(
                run_id=run_id,
                member_run_id=member_run_id,
                member_name=member_name,
                task=self._task,
                text=text,
            )

        if event_name == RunEvent.reasoning_completed.value:
            return ReasoningCompleted(
                run_id=run_id,
                member_run_id=member_run_id,
                member_name=member_name,
                task=self._task,
            )

        if event_name == RunEvent.tool_call_started.value:
            tool = _runtime_tool_call(getattr(event, "tool", None))
            if tool is None:
                return None
            return ToolCallStarted(
                run_id=run_id,
                member_run_id=member_run_id,
                member_name=member_name,
                task=self._task,
                tool=tool,
            )

        if event_name == RunEvent.tool_call_completed.value:
            tool = _runtime_tool_result(getattr(event, "tool", None))
            if tool is None:
                return None
            self._latest_tools.pop(tool.id, None)
            return ToolCallCompleted(
                run_id=run_id,
                member_run_id=member_run_id,
                member_name=member_name,
                task=self._task,
                tool=tool,
            )

        if event_name == RunEvent.run_paused.value:
            tools = list(getattr(event, "tools_requiring_confirmation", None) or [])
            if not tools:
                tools = list(getattr(event, "tools", None) or [])
            if not tools:
                return None
            self._latest_tools = {
                str(getattr(tool, "tool_call_id", "") or ""): cast(ToolExecution, tool)
                for tool in tools
                if getattr(tool, "tool_call_id", None)
            }
            pending = [_pending_approval(tool) for tool in tools]
            pending = [tool for tool in pending if tool is not None]
            return ApprovalRequired(
                run_id=run_id,
                member_run_id=member_run_id,
                member_name=member_name,
                task=self._task,
                tools=pending,
            )

        if event_name == RunEvent.model_request_completed.value:
            return ModelUsage(
                run_id=run_id,
                member_run_id=member_run_id,
                member_name=member_name,
                task=self._task,
                input_tokens=getattr(event, "input_tokens", None),
                output_tokens=getattr(event, "output_tokens", None),
                total_tokens=getattr(event, "total_tokens", None),
                cache_read_tokens=getattr(event, "cache_read_tokens", None),
                cache_write_tokens=getattr(event, "cache_write_tokens", None),
                reasoning_tokens=getattr(event, "reasoning_tokens", None),
                time_to_first_token=getattr(event, "time_to_first_token", None),
                model=getattr(event, "model", None),
                provider=getattr(event, "model_provider", None),
            )

        if event_name == RunEvent.run_completed.value:
            content = getattr(event, "content", None)
            return RunCompleted(
                run_id=run_id,
                member_run_id=member_run_id,
                member_name=member_name,
                task=self._task,
                content=str(content) if content is not None else None,
            )

        if event_name == RunEvent.run_cancelled.value:
            return RunCancelled(
                run_id=run_id,
                member_run_id=member_run_id,
                member_name=member_name,
                task=self._task,
            )

        if event_name == RunEvent.run_error.value:
            content = getattr(event, "content", None)
            return RunError(
                run_id=run_id,
                member_run_id=member_run_id,
                member_name=member_name,
                task=self._task,
                message=str(content) if content is not None else "Agent run failed",
            )

        return None


class AgnoRuntimeAdapter:
    def __init__(self) -> None:
        self._db = InMemoryDb()

    def create_agent(
        self,
        config: AgentConfig,
        *,
        member_name: str | None = None,
        task: str | None = None,
        on_event: Callable[[RuntimeEventT], None] | None = None,
        runnable: Any | None = None,
    ) -> AgentHandle:
        agent = runnable or Agent(
            name=config.name,
            model=config.model,
            tools=config.tools or None,
            description=config.description,
            instructions=config.instructions or None,
            markdown=True,
            stream_events=True,
            db=self._db,
        )
        return AgnoAgentHandle(
            agent,
            member_name=member_name,
            task=task,
            on_event=on_event,
        )


def _to_agno_messages(message: RuntimeMessage) -> list[Message]:
    if message.role == "user":
        images: list[Any] = []
        files: list[Any] = []
        audio: list[Any] = []
        videos: list[Any] = []
        for attachment in message.attachments:
            media = _attachment_to_media(attachment)
            if media is None:
                continue
            if attachment.kind == "image":
                images.append(media)
            elif attachment.kind == "audio":
                audio.append(media)
            elif attachment.kind == "video":
                videos.append(media)
            else:
                files.append(media)
        return [
            Message(
                role="user",
                content=message.content or "",
                images=images or None,
                files=files or None,
                audio=audio or None,
                videos=videos or None,
            )
        ]

    if message.role == "assistant":
        payload: dict[str, Any] = {
            "role": "assistant",
            "content": message.content,
        }
        if message.tool_calls:
            payload["tool_calls"] = [
                {
                    "id": tool_call.id,
                    "type": "function",
                    "function": {
                        "name": tool_call.name,
                        "arguments": json.dumps(tool_call.arguments or {}),
                    },
                    **(
                        {"providerData": tool_call.provider_data}
                        if tool_call.provider_data
                        else {}
                    ),
                }
                for tool_call in message.tool_calls
            ]
        return [Message(**payload)]

    if message.role == "tool":
        return [
            Message(
                role="tool",
                tool_call_id=message.tool_call_id,
                content=message.content or "",
            )
        ]

    return []


def _attachment_to_media(attachment: RuntimeAttachment) -> Any | None:
    path = Path(attachment.path)
    if not path.exists():
        return None
    if attachment.kind == "image":
        from agno.media import Image

        return Image(filepath=path)
    if attachment.kind == "audio":
        from agno.media import Audio

        return Audio(filepath=path)
    if attachment.kind == "video":
        from agno.media import Video

        return Video(filepath=path)
    from agno.media import File

    return File(filepath=path, name=attachment.name or path.name)


def _runtime_tool_call(tool: Any) -> RuntimeToolCall | None:
    if tool is None:
        return None
    tool_id = str(getattr(tool, "tool_call_id", "") or "")
    tool_name = str(getattr(tool, "tool_name", "") or "")
    if not tool_id or not tool_name:
        return None
    provider_data = getattr(tool, "provider_data", None)
    if not isinstance(provider_data, dict) or not provider_data:
        provider_data = None
    return RuntimeToolCall(
        id=tool_id,
        name=get_original_tool_name(tool_name),
        arguments=dict(getattr(tool, "tool_args", None) or {}),
        provider_data=provider_data,
    )


def _runtime_tool_result(tool: Any) -> RuntimeToolResult | None:
    call = _runtime_tool_call(tool)
    if call is None:
        return None
    result = getattr(tool, "result", None)
    error = getattr(tool, "error", None)
    return RuntimeToolResult(
        id=call.id,
        name=call.name,
        result=str(result) if result is not None else None,
        error=str(error) if error is not None else None,
        provider_data=call.provider_data,
        failed=error is not None,
    )


def _pending_approval(tool: Any) -> PendingApproval | None:
    call = _runtime_tool_call(tool)
    if call is None:
        return None
    schema = getattr(tool, "user_input_schema", None)
    serialized_schema: list[dict[str, Any]] | None = None
    if isinstance(schema, list):
        serialized_schema = [
            item.to_dict() if hasattr(item, "to_dict") else dict(item)
            for item in schema
            if hasattr(item, "to_dict") or isinstance(item, dict)
        ]
    return PendingApproval(
        tool_call_id=call.id,
        tool_name=call.name,
        tool_args=call.arguments,
        editable_args=None,
        requires_user_input=bool(getattr(tool, "requires_user_input", False)),
        user_input_schema=serialized_schema,
    )


def _event_name(event: Any) -> str:
    if isinstance(event, RunEvent):
        return str(event.value)
    return str(event) if event is not None else ""
