"""Agent node — resolves tools and runs an Agno Agent or Team."""

from __future__ import annotations

import asyncio
import json
from enum import Enum
from typing import Any

from agno.agent import Agent, Message
from agno.db.in_memory import InMemoryDb
from agno.run.agent import BaseAgentRunEvent
from agno.team import Team

from backend.services import run_control
from backend.services.model_factory import get_model
from nodes._types import DataValue, ExecutionResult, FlowContext, NodeEvent

_agent_db = InMemoryDb()
AGENT_STREAM_IDLE_TIMEOUT_SECONDS = 20.0


class AgentExecutor:
    node_type = "agent"

    async def materialize(
        self,
        data: dict[str, Any],
        output_handle: str,
        context: FlowContext,
    ) -> Agent | Team:
        if output_handle not in {"input", "output", "tools"}:
            raise ValueError(
                f"agent node cannot materialize unknown output handle: {output_handle}"
            )

        model_str = str(data.get("model", ""))
        linked_model = await _resolve_flow_input(context, "model")
        if linked_model is not None:
            candidate = _extract_text(linked_model)
            if candidate:
                model_str = candidate

        temperature = _coerce_optional_float(data.get("temperature"))
        linked_temperature = await _resolve_flow_input(context, "temperature")
        if linked_temperature is not None:
            temperature = _coerce_optional_float(linked_temperature)

        instructions_text = _extract_text(data.get("instructions", ""))
        linked_instructions = await _resolve_flow_input(context, "instructions")
        if linked_instructions is not None:
            instructions_text = _extract_text(linked_instructions)
        instructions = [instructions_text] if instructions_text else None

        return await _build_runtime_runnable(
            data,
            context,
            model_str=model_str,
            temperature=temperature,
            instructions=instructions,
        )

    async def execute(
        self, data: dict[str, Any], inputs: dict[str, DataValue], context: FlowContext
    ):
        input_dv = inputs.get("input", DataValue("data", {}))
        raw = input_dv.value
        input_value = raw if isinstance(raw, dict) else {"message": str(raw)}

        message = _resolve_agent_message(input_value)

        model_input = inputs.get("model")
        model_str = _extract_text(model_input.value) if model_input else ""
        if not model_str:
            model_str = str(data.get("model", ""))

        temperature_input = inputs.get("temperature")
        temperature = (
            _coerce_optional_float(temperature_input.value)
            if temperature_input is not None and temperature_input.value is not None
            else _coerce_optional_float(data.get("temperature"))
        )

        instructions_input = inputs.get("instructions")
        instructions_text = (
            _extract_text(instructions_input.value)
            if instructions_input is not None and instructions_input.value is not None
            else _extract_text(data.get("instructions", ""))
        )
        instructions = [instructions_text] if instructions_text else None

        agent = await _build_runtime_runnable(
            data,
            context,
            model_str=model_str,
            temperature=temperature,
            instructions=instructions,
        )

        run_handle = _get_run_handle(context)
        if run_handle is not None and hasattr(run_handle, "bind_agent"):
            run_handle.bind_agent(agent)

        yield NodeEvent(
            node_id=context.node_id,
            node_type=self.node_type,
            event_type="started",
            run_id=context.run_id,
            data={"agent": data.get("name", "Agent")},
        )

        try:
            content_parts: list[str] = []
            fallback_final = ""
            seen_member_run_ids: set[str] = set()
            active_run_id = ""
            run_input = _resolve_run_input(input_value, message)

            stream = agent.arun(
                input=run_input,
                add_history_to_context=True,
                stream=True,
                stream_events=True,
            ).__aiter__()

            while True:
                try:
                    chunk = await asyncio.wait_for(
                        stream.__anext__(),
                        timeout=AGENT_STREAM_IDLE_TIMEOUT_SECONDS,
                    )
                except StopAsyncIteration:
                    break
                except asyncio.TimeoutError:
                    raise RuntimeError(
                        f"Agent stream timed out after {AGENT_STREAM_IDLE_TIMEOUT_SECONDS:.0f}s"
                    )

                event_name = _event_name(getattr(chunk, "event", None))
                chunk_run_id = str(getattr(chunk, "run_id", "") or "")

                if chunk_run_id and chunk_run_id != active_run_id:
                    active_run_id = chunk_run_id
                    if run_handle is not None and hasattr(run_handle, "set_run_id"):
                        run_handle.set_run_id(active_run_id)
                    yield NodeEvent(
                        node_id=context.node_id,
                        node_type=self.node_type,
                        event_type="agent_run_id",
                        run_id=context.run_id,
                        data={"run_id": active_run_id},
                    )

                member_fields = _member_event_fields(chunk)
                member_run_id = str(member_fields.get("memberRunId", "") or "")
                if member_run_id and member_run_id not in seen_member_run_ids:
                    seen_member_run_ids.add(member_run_id)
                    yield NodeEvent(
                        node_id=context.node_id,
                        node_type=self.node_type,
                        event_type="agent_event",
                        run_id=context.run_id,
                        data={"event": "MemberRunStarted", **member_fields},
                    )

                if event_name in {"RunContent", "TeamRunContent"}:
                    reasoning_text = str(getattr(chunk, "reasoning_content", "") or "")
                    if reasoning_text:
                        yield NodeEvent(
                            node_id=context.node_id,
                            node_type=self.node_type,
                            event_type="agent_event",
                            run_id=context.run_id,
                            data={
                                "event": "ReasoningStep",
                                "reasoningContent": reasoning_text,
                                **member_fields,
                            },
                        )

                    token = str(getattr(chunk, "content", "") or "")
                    if token:
                        if member_fields:
                            yield NodeEvent(
                                node_id=context.node_id,
                                node_type=self.node_type,
                                event_type="agent_event",
                                run_id=context.run_id,
                                data={
                                    "event": "RunContent",
                                    "content": token,
                                    **member_fields,
                                },
                            )
                        else:
                            content_parts.append(token)
                            yield NodeEvent(
                                node_id=context.node_id,
                                node_type=self.node_type,
                                event_type="progress",
                                run_id=context.run_id,
                                data={"token": token},
                            )
                    continue

                if event_name in {
                    "ReasoningStarted",
                    "TeamReasoningStarted",
                }:
                    yield NodeEvent(
                        node_id=context.node_id,
                        node_type=self.node_type,
                        event_type="agent_event",
                        run_id=context.run_id,
                        data={"event": "ReasoningStarted", **member_fields},
                    )
                    continue

                if event_name in {
                    "ReasoningStep",
                    "ReasoningContentDelta",
                    "TeamReasoningStep",
                    "TeamReasoningContentDelta",
                }:
                    reasoning_text = str(getattr(chunk, "reasoning_content", "") or "")
                    if reasoning_text:
                        yield NodeEvent(
                            node_id=context.node_id,
                            node_type=self.node_type,
                            event_type="agent_event",
                            run_id=context.run_id,
                            data={
                                "event": "ReasoningStep",
                                "reasoningContent": reasoning_text,
                                **member_fields,
                            },
                        )
                    continue

                if event_name in {
                    "ReasoningCompleted",
                    "TeamReasoningCompleted",
                }:
                    yield NodeEvent(
                        node_id=context.node_id,
                        node_type=self.node_type,
                        event_type="agent_event",
                        run_id=context.run_id,
                        data={"event": "ReasoningCompleted", **member_fields},
                    )
                    continue

                if event_name in {"ToolCallStarted", "TeamToolCallStarted"}:
                    tool = _tool_started_payload(chunk)
                    if tool is not None:
                        yield NodeEvent(
                            node_id=context.node_id,
                            node_type=self.node_type,
                            event_type="agent_event",
                            run_id=context.run_id,
                            data={
                                "event": "ToolCallStarted",
                                "tool": tool,
                                **member_fields,
                            },
                        )
                    continue

                if event_name in {"ToolCallCompleted", "TeamToolCallCompleted"}:
                    tool = _tool_completed_payload(chunk)
                    if tool is not None:
                        yield NodeEvent(
                            node_id=context.node_id,
                            node_type=self.node_type,
                            event_type="agent_event",
                            run_id=context.run_id,
                            data={
                                "event": "ToolCallCompleted",
                                "tool": tool,
                                **member_fields,
                            },
                        )
                    continue

                if event_name in {"RunPaused", "TeamRunPaused"}:
                    if not active_run_id:
                        active_run_id = chunk_run_id or context.run_id

                    tools = _approval_tools(chunk)
                    if not tools:
                        continue

                    tools_info: list[dict[str, Any]] = []
                    for tool in tools:
                        tool_id = getattr(tool, "tool_call_id", "")
                        tool_name = getattr(tool, "tool_name", "")
                        tool_args = getattr(tool, "tool_args", None)
                        tool_info: dict[str, Any] = {
                            "id": tool_id,
                            "toolName": tool_name,
                            "toolArgs": tool_args,
                        }
                        tool_registry = _get_tool_registry(context)
                        editable_args = (
                            tool_registry.get_editable_args(tool_name)
                            if tool_registry is not None
                            else None
                        )
                        if editable_args:
                            tool_info["editableArgs"] = editable_args
                        tools_info.append(tool_info)

                    yield NodeEvent(
                        node_id=context.node_id,
                        node_type=self.node_type,
                        event_type="agent_event",
                        run_id=context.run_id,
                        data={
                            "event": "ToolApprovalRequired",
                            "tool": {"runId": active_run_id, "tools": tools_info},
                        },
                    )

                    approval_event = asyncio.Event()
                    run_control.register_approval_waiter(active_run_id, approval_event)
                    timed_out = False
                    try:
                        await asyncio.wait_for(approval_event.wait(), timeout=300)
                    except asyncio.TimeoutError:
                        timed_out = True
                        for tool in tools:
                            setattr(tool, "confirmed", False)
                    else:
                        response = run_control.get_approval_response(active_run_id)
                        tool_decisions = response.get("tool_decisions", {})
                        edited_args = response.get("edited_args", {})
                        default_approved = response.get("approved", False)
                        for tool in tools:
                            tool_id = getattr(tool, "tool_call_id", "")
                            setattr(
                                tool,
                                "confirmed",
                                tool_decisions.get(tool_id, default_approved),
                            )
                            if tool_id and tool_id in edited_args:
                                setattr(tool, "tool_args", edited_args[tool_id])
                    finally:
                        run_control.clear_approval(active_run_id)

                    for tool in tools:
                        tool_id = getattr(tool, "tool_call_id", "")
                        status = (
                            "timeout"
                            if timed_out
                            else (
                                "approved"
                                if bool(getattr(tool, "confirmed", False))
                                else "denied"
                            )
                        )
                        yield NodeEvent(
                            node_id=context.node_id,
                            node_type=self.node_type,
                            event_type="agent_event",
                            run_id=context.run_id,
                            data={
                                "event": "ToolApprovalResolved",
                                "tool": {
                                    "id": tool_id,
                                    "approvalStatus": status,
                                    "toolArgs": getattr(tool, "tool_args", None),
                                },
                            },
                        )

                    stream = agent.acontinue_run(
                        run_id=active_run_id,
                        updated_tools=tools,
                        stream=True,
                        stream_events=True,
                    ).__aiter__()
                    continue

                if event_name in {"RunCancelled", "TeamRunCancelled"}:
                    yield NodeEvent(
                        node_id=context.node_id,
                        node_type=self.node_type,
                        event_type="cancelled",
                        run_id=context.run_id,
                    )
                    yield ExecutionResult(
                        outputs={
                            "output": DataValue(type="data", value={"response": ""})
                        }
                    )
                    return

                if event_name in {"RunCompleted", "TeamRunCompleted"}:
                    if member_fields:
                        yield NodeEvent(
                            node_id=context.node_id,
                            node_type=self.node_type,
                            event_type="agent_event",
                            run_id=context.run_id,
                            data={"event": "MemberRunCompleted", **member_fields},
                        )
                        continue
                    if not content_parts:
                        fallback_final = str(getattr(chunk, "content", "") or "")
                    break

                if event_name in {"RunError", "TeamRunError"}:
                    if member_fields:
                        yield NodeEvent(
                            node_id=context.node_id,
                            node_type=self.node_type,
                            event_type="agent_event",
                            run_id=context.run_id,
                            data={
                                "event": "MemberRunError",
                                "content": str(
                                    getattr(chunk, "content", None)
                                    or "Agent run failed"
                                ),
                                **member_fields,
                            },
                        )
                        continue
                    raise RuntimeError(
                        str(getattr(chunk, "content", None) or "Agent run failed")
                    )

                if event_name:
                    yield NodeEvent(
                        node_id=context.node_id,
                        node_type=self.node_type,
                        event_type="agent_event",
                        run_id=context.run_id,
                        data={"event": event_name, **member_fields},
                    )

            content = "".join(content_parts) if content_parts else fallback_final

            yield ExecutionResult(
                outputs={
                    "output": DataValue(type="data", value={"response": content or ""})
                }
            )
        except Exception as e:
            yield NodeEvent(
                node_id=context.node_id,
                node_type=self.node_type,
                event_type="error",
                run_id=context.run_id,
                data={"error": str(e)},
            )
            yield ExecutionResult(
                outputs={"output": DataValue(type="data", value={"response": ""})}
            )


def _event_name(event: Any) -> str:
    if isinstance(event, Enum):
        return str(event.value)
    return str(event) if event is not None else ""


def _extract_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, dict):
        for key in ("message", "text", "response", "content"):
            candidate = value.get(key)
            if candidate is not None:
                return str(candidate)
        return str(value)
    return str(value)


def _content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        text_parts: list[str] = []
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") != "text":
                continue
            part = block.get("content")
            if part is not None:
                text_parts.append(str(part))
        return "".join(text_parts)
    return _extract_text(content)


def _last_user_message_from_history(history: Any) -> str:
    if not isinstance(history, list):
        return ""

    for entry in reversed(history):
        if not isinstance(entry, dict):
            continue
        if entry.get("role") != "user":
            continue
        return _content_to_text(entry.get("content"))

    return ""


def _resolve_agent_message(input_value: dict[str, Any]) -> str:
    for key in ("message", "last_user_message", "text", "response", "content"):
        candidate = input_value.get(key)
        if candidate is None:
            continue
        message = _content_to_text(candidate)
        if message:
            return message

    history_message = _last_user_message_from_history(input_value.get("history"))
    if history_message:
        return history_message

    return _extract_text(input_value)


def _coerce_optional_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    return float(value)


def _resolve_model(model_str: str, temperature: float | None = None) -> Any:
    if ":" not in model_str:
        raise ValueError(
            f"Invalid model format '{model_str}' — expected 'provider:model_id'"
        )
    provider, model_id = model_str.split(":", 1)
    if temperature is not None:
        return get_model(provider, model_id, temperature=temperature)
    return get_model(provider, model_id)


async def _resolve_flow_input(context: FlowContext, target_handle: str) -> Any | None:
    runtime = context.runtime
    if runtime is None:
        return None

    for edge in runtime.incoming_edges(
        context.node_id,
        channel="flow",
        target_handle=target_handle,
    ):
        source_id = edge.get("source")
        if not source_id:
            continue
        source_handle = edge.get("sourceHandle") or "output"
        value = await runtime.materialize_output(source_id, source_handle)
        if value is not None:
            return value

    return None


def _get_run_handle(context: FlowContext) -> Any | None:
    services = context.services
    if services is None:
        return None
    return getattr(services, "run_handle", None)


def _get_chat_scope(context: FlowContext) -> Any | None:
    services = context.services
    if services is None:
        return None
    return getattr(services, "chat_scope", None)


def _resolve_run_input(
    input_value: dict[str, Any],
    default_message: str,
) -> Any:
    for key in ("agno_messages", "messages"):
        parsed_messages = _coerce_messages(input_value.get(key))
        if parsed_messages:
            return parsed_messages

    return default_message


def _coerce_messages(value: Any) -> list[Message]:
    if value is None:
        return []

    if isinstance(value, Message):
        return [value]

    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return []
        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError:
            return [Message(role="user", content=stripped)]
        return _coerce_messages(parsed)

    if isinstance(value, dict):
        return _coerce_message_item(value)

    if isinstance(value, list):
        messages: list[Message] = []
        for item in value:
            messages.extend(_coerce_message_item(item))
        return messages

    return []


def _coerce_message_item(item: Any) -> list[Message]:
    if isinstance(item, Message):
        return [item]

    if isinstance(item, dict):
        role = str(item.get("role") or "user")
        content = _content_to_text(item.get("content"))
        payload: dict[str, Any] = {"role": role, "content": content}

        tool_call_id = item.get("tool_call_id") or item.get("toolCallId")
        if role == "tool" and tool_call_id:
            payload["tool_call_id"] = str(tool_call_id)

        tool_calls = item.get("tool_calls") or item.get("toolCalls")
        if role == "assistant" and isinstance(tool_calls, list):
            payload["tool_calls"] = tool_calls

        return [Message(**payload)]

    return []


def _get_tool_registry(context: FlowContext) -> Any | None:
    services = context.services
    if services is None:
        return None
    return getattr(services, "tool_registry", None)


def _member_event_fields(chunk: Any) -> dict[str, Any]:
    if not isinstance(chunk, BaseAgentRunEvent):
        return {}

    member_run_id = str(getattr(chunk, "run_id", "") or "")
    member_name = str(getattr(chunk, "agent_name", "") or "Member")
    if not member_run_id:
        return {}
    return {"memberRunId": member_run_id, "memberName": member_name}


def _tool_started_payload(chunk: Any) -> dict[str, Any] | None:
    tool = getattr(chunk, "tool", None)
    if tool is None:
        return None
    return {
        "id": getattr(tool, "tool_call_id", None),
        "toolName": getattr(tool, "tool_name", None),
        "toolArgs": getattr(tool, "tool_args", None),
        "isCompleted": False,
    }


def _tool_completed_payload(chunk: Any) -> dict[str, Any] | None:
    tool = getattr(chunk, "tool", None)
    if tool is None:
        return None
    result = getattr(tool, "result", None)
    return {
        "id": getattr(tool, "tool_call_id", None),
        "toolName": getattr(tool, "tool_name", None),
        "toolResult": str(result) if result is not None else None,
    }


def _approval_tools(chunk: Any) -> list[Any]:
    requiring_confirmation = getattr(chunk, "tools_requiring_confirmation", None)
    if requiring_confirmation:
        return list(requiring_confirmation)

    tools = getattr(chunk, "tools", None)
    if tools:
        return list(tools)
    return []


async def _build_runtime_runnable(
    data: dict[str, Any],
    context: FlowContext,
    *,
    model_str: str,
    temperature: float | None,
    instructions: list[str] | None,
) -> Agent | Team:
    model = _resolve_model(model_str, temperature)
    tools, sub_agents = await _resolve_link_dependencies(context)

    if not sub_agents:
        return Agent(
            name=data.get("name", "Agent"),
            model=model,
            tools=tools or None,
            description=data.get("description", ""),
            instructions=instructions,
            markdown=True,
            stream_events=True,
            db=_agent_db,
        )

    return Team(
        name=data.get("name", "Agent"),
        model=model,
        tools=tools or None,
        description=data.get("description", ""),
        instructions=instructions,
        members=sub_agents,
        markdown=True,
        stream_events=True,
        stream_member_events=True,
        db=_agent_db,
    )


async def _resolve_link_dependencies(
    context: FlowContext,
) -> tuple[list[Any], list[Any]]:
    artifacts: list[Any] = []
    runtime = context.runtime
    if runtime is not None:
        artifacts.extend(await runtime.resolve_links(context.node_id, "tools"))

    extra_tools = _resolve_extra_tools(context)
    if extra_tools:
        artifacts.extend(extra_tools)

    tools: list[Any] = []
    sub_agents: list[Any] = []
    for artifact in _flatten_link_artifacts(artifacts):
        if isinstance(artifact, (Agent, Team)):
            sub_agents.append(artifact)
            continue
        if artifact is not None:
            tools.append(artifact)

    return tools, sub_agents


def _resolve_extra_tools(context: FlowContext) -> list[Any]:
    services = context.services
    if services is None:
        return []

    extra_tool_ids = getattr(services, "extra_tool_ids", None)
    if not extra_tool_ids:
        return []

    if not _should_include_extra_tools(context):
        return []

    tool_registry = _get_tool_registry(context)
    if tool_registry is None:
        return []

    return tool_registry.resolve_tool_ids(
        list(extra_tool_ids),
        chat_id=context.chat_id,
    )


def _flatten_link_artifacts(artifacts: list[Any]) -> list[Any]:
    flattened: list[Any] = []
    for artifact in artifacts:
        if isinstance(artifact, list):
            flattened.extend(_flatten_link_artifacts(artifact))
            continue
        flattened.append(artifact)
    return flattened


def _should_include_extra_tools(context: FlowContext) -> bool:
    chat_scope = _get_chat_scope(context)
    if chat_scope is not None and hasattr(chat_scope, "include_user_tools"):
        return bool(chat_scope.include_user_tools(context.node_id))

    runtime = context.runtime
    if runtime is None:
        return True

    incoming = runtime.incoming_edges(
        context.node_id,
        channel="flow",
        target_handle="input",
    )
    for edge in incoming:
        source_id = edge.get("source")
        if not source_id:
            continue
        source_node = runtime.get_node(source_id)
        if source_node.get("type") != "chat-start":
            continue
        return bool(source_node.get("data", {}).get("includeUserTools", False))

    return True


executor = AgentExecutor()
