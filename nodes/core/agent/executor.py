"""Agent node — resolves tools and runs via runtime adapter."""

from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

from backend.providers import resolve_provider_options
from backend.runtime import (
    AgentConfig,
    AgentHandle,
    ApprovalRequired,
    ApprovalResolved,
    ApprovalResponse,
    ContentDelta,
    ReasoningCompleted,
    ReasoningDelta,
    ReasoningStarted,
    RunCancelled,
    RunCompleted,
    RunError,
    RunStarted,
    RuntimeAdapter,
    RuntimeAttachment,
    RuntimeEventT,
    RuntimeMessage,
    RuntimeToolCall,
    ToolCallCompleted,
    ToolCallStarted,
    ToolDecision,
    get_adapter,
)
from backend.services.models.model_factory import get_model
from backend.services.models.model_schema_cache import get_cached_model_metadata
from backend.services.streaming import run_control
from backend.services.tools.tool_registry import get_original_tool_name
from nodes._types import DataValue, ExecutionResult, FlowContext, NodeEvent
from nodes._variables import node_model_variable_id

_runtime_adapter: RuntimeAdapter = get_adapter()
AGENT_STREAM_IDLE_TIMEOUT_SECONDS = float(
    os.getenv("AGENT_STREAM_IDLE_TIMEOUT_SECONDS", "900")
)
_DELEGATION_TOOL_TASK_ARG = "task"


@dataclass(slots=True)
class LinkedAgentArtifact:
    config: AgentConfig
    node_id: str
    node_type: str
    name: str
    tools: list[Any] = field(default_factory=list)
    linked_agents: list[LinkedAgentArtifact] = field(default_factory=list)


@dataclass(slots=True)
class DelegationContext:
    queue: asyncio.Queue[Any] = field(default_factory=asyncio.Queue)
    active_delegations: int = 0
    root_run_id: str = ""
    cancelled: bool = False


@dataclass(slots=True)
class _StreamDone:
    kind: str


@dataclass(slots=True)
class _StreamError:
    error: Exception


class AgentExecutor:
    node_type = "agent"

    def declare_variables(
        self,
        data: dict[str, Any],
        context: FlowContext | None = None,
    ) -> list[dict[str, Any]]:
        del context
        if data.get("disableModelVariable") is True:
            return []
        agent_name = str(data.get("name") or "Agent")
        return [
            {
                "id": "model",
                "label": "Model",
                "section": agent_name,
                "control": {"kind": "searchable", "grouped": True},
                "options": {"kind": "callback", "load": "models:list"},
                "default": data.get("model", ""),
                "placement": "header",
            },
        ]

    async def materialize(
        self,
        data: dict[str, Any],
        output_handle: str,
        context: FlowContext,
    ) -> LinkedAgentArtifact:
        if output_handle not in {"input", "output", "tools"}:
            raise ValueError(
                f"agent node cannot materialize unknown output handle: {output_handle}"
            )

        model_str = await _resolve_agent_model(data, context, input_value=None)

        temperature = _coerce_optional_float(data.get("temperature"))
        linked_temperature = await _resolve_flow_input(context, "temperature")
        if linked_temperature is not None:
            temperature = _coerce_optional_float(linked_temperature)

        instructions_text = _extract_text(data.get("instructions", ""))
        linked_instructions = await _resolve_flow_input(context, "instructions")
        if linked_instructions is not None:
            instructions_text = _extract_text(linked_instructions)
        instructions = [instructions_text] if instructions_text else []

        return await _build_runtime_runnable(
            data,
            context,
            model_str=model_str,
            temperature=temperature,
            instructions=instructions,
            input_value=None,
        )

    async def execute(
        self,
        data: dict[str, Any],
        inputs: dict[str, DataValue],
        context: FlowContext,
    ):
        input_dv = inputs.get("input", DataValue("data", {}))
        raw = input_dv.value
        input_value = raw if isinstance(raw, dict) else {"message": str(raw)}
        message = _resolve_agent_message(input_value)

        model_str = await _resolve_agent_model(
            data,
            context,
            input_value=input_value,
            model_input=inputs.get("model"),
        )

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
        instructions = [instructions_text] if instructions_text else []

        delegation_context = DelegationContext()
        config, base_tools, linked_agents = await _build_agent_config(
            data,
            context,
            model_str=model_str,
            temperature=temperature,
            instructions=instructions,
            input_value=input_value,
            delegation_context=delegation_context,
        )
        tool_node_lookup = _build_tool_node_lookup(base_tools + config.tools)
        delegation_tool_names = {_safe_delegation_tool_name(a) for a in linked_agents}

        group_by_node = _should_group_by_node(context)
        force_member_output = _force_member_output(context)
        root_member_name = _resolve_grouped_member_name(data, config.name)

        run_handle = _get_run_handle(context)
        handle = _build_agent_or_team(
            data,
            model=config.model,
            tools=config.tools,
            instructions=config.instructions,
        )
        if run_handle is not None and hasattr(run_handle, "bind_agent"):
            run_handle.bind_agent(handle)

        yield NodeEvent(
            node_id=context.node_id,
            node_type=self.node_type,
            event_type="started",
            run_id=context.run_id,
            data={"agent": config.name},
        )

        active_root_streams = 1
        root_run_id = ""
        fallback_final = ""
        content_parts: list[str] = []

        messages_override = _resolve_messages_override(data)
        runtime_messages = _coerce_runtime_messages(
            _resolve_run_input(input_value, message, messages_override)
        )
        if not runtime_messages:
            runtime_messages = [RuntimeMessage(role="user", content=message)]

        root_pump = asyncio.create_task(
            _pump_runtime_events(
                handle.run(runtime_messages, add_history_to_context=True),
                delegation_context.queue,
                kind="root",
            )
        )

        try:
            while True:
                if (
                    active_root_streams == 0
                    and delegation_context.active_delegations == 0
                    and delegation_context.queue.empty()
                ):
                    break

                item = await delegation_context.queue.get()
                if isinstance(item, _StreamDone):
                    if item.kind == "root":
                        active_root_streams = max(0, active_root_streams - 1)
                    else:
                        delegation_context.active_delegations = max(
                            0, delegation_context.active_delegations - 1
                        )
                    continue

                if isinstance(item, _StreamError):
                    raise item.error

                if isinstance(item, NodeEvent):
                    yield item
                    continue

                if not isinstance(item, tuple) or len(item) != 2:
                    continue
                scope, event = item
                if not isinstance(event, tuple(_runtime_event_types())):
                    continue

                if scope == "root":
                    member_fields = _root_member_fields(
                        context=context,
                        data=data,
                        event=event,
                        force_member_output=force_member_output,
                        group_by_node=group_by_node,
                        member_name=root_member_name,
                    )
                    if event.run_id and event.run_id != root_run_id:
                        root_run_id = event.run_id
                        delegation_context.root_run_id = root_run_id
                        if run_handle is not None and hasattr(run_handle, "set_run_id"):
                            run_handle.set_run_id(root_run_id)
                        yield NodeEvent(
                            node_id=context.node_id,
                            node_type=self.node_type,
                            event_type="agent_run_id",
                            run_id=context.run_id,
                            data={"run_id": root_run_id},
                        )

                    if isinstance(event, ContentDelta):
                        if member_fields:
                            if force_member_output:
                                content_parts.append(event.text)
                            yield _agent_event_node(
                                context,
                                "RunContent",
                                content=event.text,
                                **member_fields,
                            )
                        else:
                            content_parts.append(event.text)
                            yield NodeEvent(
                                node_id=context.node_id,
                                node_type=self.node_type,
                                event_type="progress",
                                run_id=context.run_id,
                                data={"token": event.text},
                            )
                        continue

                    if isinstance(event, ReasoningStarted):
                        yield _agent_event_node(
                            context,
                            "ReasoningStarted",
                            **member_fields,
                        )
                        continue

                    if isinstance(event, ReasoningDelta):
                        yield _agent_event_node(
                            context,
                            "ReasoningStep",
                            reasoningContent=event.text,
                            **member_fields,
                        )
                        continue

                    if isinstance(event, ReasoningCompleted):
                        yield _agent_event_node(
                            context,
                            "ReasoningCompleted",
                            **member_fields,
                        )
                        continue

                    if isinstance(event, ToolCallStarted):
                        tool = _tool_payload_from_runtime_call(event.tool)
                        if tool is not None:
                            _attach_tool_node_metadata(tool, tool_node_lookup)
                            if tool.get("toolName") in delegation_tool_names:
                                tool["isDelegation"] = True
                            yield _agent_event_node(
                                context,
                                "ToolCallStarted",
                                tool=tool,
                                **member_fields,
                            )
                        continue

                    if isinstance(event, ToolCallCompleted):
                        tool = _tool_payload_from_runtime_result(event.tool)
                        if tool is not None:
                            _attach_tool_node_metadata(tool, tool_node_lookup)
                            if tool.get("toolName") in delegation_tool_names:
                                tool["isDelegation"] = True
                            yield _agent_event_node(
                                context,
                                "ToolCallCompleted",
                                tool=tool,
                                **member_fields,
                            )
                        continue

                    if isinstance(event, ApprovalRequired):
                        required_events = _build_approval_required_events(
                            context=context,
                            runtime_event=event,
                            tool_node_lookup=tool_node_lookup,
                            member_fields=member_fields,
                        )
                        for ev in required_events:
                            yield ev

                        approval, resolved_events = await _await_and_resolve_approval(
                            context=context,
                            runtime_event=event,
                            tool_node_lookup=tool_node_lookup,
                            member_fields=member_fields,
                            owner_run_id=delegation_context.root_run_id or context.run_id,
                        )
                        for ev in resolved_events:
                            yield ev

                        if approval.cancelled:
                            yield NodeEvent(
                                node_id=context.node_id,
                                node_type=self.node_type,
                                event_type="cancelled",
                                run_id=context.run_id,
                            )
                            return

                        active_root_streams += 1
                        asyncio.create_task(
                            _pump_runtime_events(
                                handle.continue_run(approval),
                                delegation_context.queue,
                                kind="root",
                            )
                        )
                        continue

                    if isinstance(event, RunCancelled):
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

                    if isinstance(event, RunCompleted):
                        if member_fields:
                            if force_member_output and not content_parts and event.content:
                                fallback_final = event.content
                            yield _agent_event_node(
                                context,
                                "MemberRunCompleted",
                                **member_fields,
                            )
                        elif not content_parts and event.content:
                            fallback_final = event.content
                        break

                    if isinstance(event, RunError):
                        if member_fields:
                            yield _agent_event_node(
                                context,
                                "MemberRunError",
                                content=event.message or "Agent run failed",
                                **member_fields,
                            )
                            if force_member_output:
                                raise RuntimeError(event.message or "Agent run failed")
                            continue
                        raise RuntimeError(event.message or "Agent run failed")

                    if isinstance(event, RunStarted) and member_fields:
                        yield _agent_event_node(
                            context,
                            "MemberRunStarted",
                            **member_fields,
                        )
                        continue

                    continue

                continue

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
        finally:
            root_pump.cancel()
            await asyncio.gather(root_pump, return_exceptions=True)


async def _pump_runtime_events(
    stream: Any,
    queue: asyncio.Queue[Any],
    *,
    kind: str,
) -> None:
    try:
        async for event in _iterate_with_timeout(stream):
            await queue.put((kind, event))
    except Exception as exc:
        await queue.put(_StreamError(exc))
    finally:
        await queue.put(_StreamDone(kind))


async def _iterate_with_timeout(stream: Any):
    iterator = stream.__aiter__()
    while True:
        try:
            item = await asyncio.wait_for(
                iterator.__anext__(),
                timeout=AGENT_STREAM_IDLE_TIMEOUT_SECONDS,
            )
        except StopAsyncIteration:
            break
        except TimeoutError as exc:
            raise RuntimeError(
                f"Agent stream timed out after {AGENT_STREAM_IDLE_TIMEOUT_SECONDS:.0f}s"
            ) from exc
        yield item


async def _build_runtime_runnable(
    data: dict[str, Any],
    context: FlowContext,
    *,
    model_str: str,
    temperature: float | None,
    instructions: list[str],
    input_value: dict[str, Any] | None,
) -> LinkedAgentArtifact:
    config, tools, linked_agents = await _build_agent_config(
        data,
        context,
        model_str=model_str,
        temperature=temperature,
        instructions=instructions,
        input_value=input_value,
        delegation_context=None,
    )
    return LinkedAgentArtifact(
        config=config,
        node_id=context.node_id,
        node_type=AgentExecutor.node_type,
        name=config.name,
        tools=tools,
        linked_agents=linked_agents,
    )


async def _build_agent_config(
    data: dict[str, Any],
    context: FlowContext,
    *,
    model_str: str,
    temperature: float | None,
    instructions: list[str],
    input_value: dict[str, Any] | None,
    delegation_context: DelegationContext | None,
) -> tuple[AgentConfig, list[Any], list[LinkedAgentArtifact]]:
    model_options = _coerce_model_options(data.get("model_options"))
    node_params = _build_node_model_params(data, temperature)
    model = _resolve_model(
        model_str,
        node_params=node_params,
        model_options=model_options,
    )
    tools, linked_agents = await _resolve_link_dependencies(context)
    if _should_disable_tools(model_str, model_options):
        tools = []
        linked_agents = []

    all_tools = list(tools)
    if delegation_context is not None:
        all_tools.extend(
            _build_delegation_tools(
                linked_agents,
                context=context,
                delegation_context=delegation_context,
            )
        )

    extra_tools = _resolve_extra_tools(context, input_value)
    if extra_tools and not _should_disable_tools(model_str, model_options):
        all_tools.extend(extra_tools)

    config = AgentConfig(
        model=model,
        tools=all_tools,
        instructions=instructions,
        name=str(data.get("name") or "Agent"),
        description=str(data.get("description") or ""),
    )
    return config, tools, linked_agents


async def _resolve_link_dependencies(
    context: FlowContext,
) -> tuple[list[Any], list[LinkedAgentArtifact]]:
    artifacts: list[Any] = []
    runtime = context.runtime
    if runtime is not None:
        artifacts.extend(await runtime.resolve_links(context.node_id, "tools"))

    tools: list[Any] = []
    linked_agents: list[LinkedAgentArtifact] = []
    for artifact in _flatten_link_artifacts(artifacts):
        if isinstance(artifact, LinkedAgentArtifact):
            linked_agents.append(artifact)
            continue
        if artifact is not None:
            tools.append(artifact)

    return tools, linked_agents


def _build_delegation_tools(
    linked_agents: list[LinkedAgentArtifact],
    *,
    context: FlowContext,
    delegation_context: DelegationContext,
) -> list[Any]:
    tools: list[Any] = []
    for artifact in linked_agents:
        tool = _build_delegation_tool(
            artifact,
            context=context,
            delegation_context=delegation_context,
        )
        if tool is not None:
            tools.append(tool)
    return tools


def _build_agent_or_team(
    data: dict[str, Any],
    *,
    model: Any,
    tools: list[Any],
    instructions: list[str] | None,
) -> AgentHandle:
    config = AgentConfig(
        model=model,
        tools=tools,
        instructions=list(instructions or []),
        name=str(data.get("name") or "Agent"),
        description=str(data.get("description") or ""),
    )
    return _runtime_adapter.create_agent(config)


def _build_delegation_tool(
    artifact: LinkedAgentArtifact,
    *,
    context: FlowContext,
    delegation_context: DelegationContext,
) -> Any | None:
    tool_name = _safe_delegation_tool_name(artifact)
    description = _delegation_tool_description(artifact)

    async def _delegate(fc: Any | None = None, **kwargs: Any) -> str:
        del fc
        task = _extract_text(kwargs.get(_DELEGATION_TOOL_TASK_ARG)).strip()
        if not task:
            raise ValueError("Delegation task is required")

        delegation_context.active_delegations += 1
        try:
            result = await _run_delegated_agent(
                artifact,
                context=context,
                delegation_context=delegation_context,
                task=task,
            )
            if delegation_context.cancelled:
                # Stop the team run and surface cancellation to agno so the parent
                # LLM cannot keep generating tokens that interpret an empty result.
                run_handle = _get_run_handle(context)
                if run_handle is not None and hasattr(run_handle, "request_cancel"):
                    try:
                        run_handle.request_cancel()
                    except Exception:
                        pass
                raise asyncio.CancelledError("Delegation cancelled by user")
            return result
        finally:
            await delegation_context.queue.put(_StreamDone("delegation"))

    _delegate.__name__ = tool_name
    _delegate.__doc__ = description

    function = _runtime_adapter.create_tool(
        name=tool_name,
        entrypoint=_delegate,
        description=description,
        parameters={
            "type": "object",
            "properties": {
                _DELEGATION_TOOL_TASK_ARG: {
                    "type": "string",
                    "description": "Task to delegate to this linked sub-agent.",
                }
            },
            "required": [_DELEGATION_TOOL_TASK_ARG],
        },
    )
    _tag_node_artifact(function, artifact.node_id, artifact.node_type)
    return function


async def _run_delegated_agent(
    artifact: LinkedAgentArtifact,
    *,
    context: FlowContext,
    delegation_context: DelegationContext,
    task: str,
) -> str:
    member_name = artifact.name or "Agent"
    handle = _runtime_adapter.create_agent(
        artifact.config,
        member_name=member_name,
        task=task,
    )

    result_parts: list[str] = []
    member_started = False
    member_fields: dict[str, Any] = {
        "memberName": member_name,
        "nodeId": artifact.node_id,
        "nodeType": artifact.node_type,
    }
    if _should_group_by_node(context):
        member_fields["groupByNode"] = True

    current_stream = handle.run([RuntimeMessage(role="user", content=task)])
    while True:
        async for event in _iterate_with_timeout(current_stream):
            if isinstance(event, RunStarted):
                run_id = event.member_run_id or event.run_id or ""
                if run_id:
                    member_fields["memberRunId"] = run_id
                if event.task:
                    member_fields["task"] = event.task
                if not member_started:
                    await delegation_context.queue.put(
                        _agent_event_node(
                            context,
                            "MemberRunStarted",
                            **member_fields,
                        )
                    )
                    member_started = True
                continue

            if isinstance(event, ContentDelta):
                result_parts.append(event.text)
                await delegation_context.queue.put(
                    _agent_event_node(
                        context,
                        "RunContent",
                        content=event.text,
                        **member_fields,
                    )
                )
                continue

            if isinstance(event, ReasoningStarted):
                await delegation_context.queue.put(
                    _agent_event_node(
                        context,
                        "ReasoningStarted",
                        **member_fields,
                    )
                )
                continue

            if isinstance(event, ReasoningDelta):
                await delegation_context.queue.put(
                    _agent_event_node(
                        context,
                        "ReasoningStep",
                        reasoningContent=event.text,
                        **member_fields,
                    )
                )
                continue

            if isinstance(event, ReasoningCompleted):
                await delegation_context.queue.put(
                    _agent_event_node(
                        context,
                        "ReasoningCompleted",
                        **member_fields,
                    )
                )
                continue

            if isinstance(event, ToolCallStarted):
                tool = _tool_payload_from_runtime_call(event.tool)
                if tool is None:
                    continue
                await delegation_context.queue.put(
                    _agent_event_node(
                        context,
                        "ToolCallStarted",
                        tool=tool,
                        **member_fields,
                    )
                )
                continue

            if isinstance(event, ToolCallCompleted):
                tool = _tool_payload_from_runtime_result(event.tool)
                if tool is None:
                    continue
                await delegation_context.queue.put(
                    _agent_event_node(
                        context,
                        "ToolCallCompleted",
                        tool=tool,
                        **member_fields,
                    )
                )
                continue

            if isinstance(event, ApprovalRequired):
                await delegation_context.queue.put(
                    _agent_event_node(
                        context,
                        "ToolApprovalRequired",
                        tool={
                            "runId": event.run_id,
                            "tools": [_pending_tool_payload(tool) for tool in event.tools],
                        },
                        **member_fields,
                    )
                )
                approval = await _await_approval_response(
                    event.run_id or context.run_id,
                    owner_run_id=delegation_context.root_run_id or context.run_id,
                )
                await _emit_approval_resolved_events(
                    context=context,
                    approval=approval,
                    runtime_event=event,
                    member_fields=member_fields,
                    queue=delegation_context.queue,
                )
                if approval.cancelled:
                    delegation_context.cancelled = True
                    return ""
                current_stream = handle.continue_run(approval)
                break

            if isinstance(event, RunCompleted):
                if not member_started:
                    run_id = event.member_run_id or event.run_id or ""
                    if run_id:
                        member_fields["memberRunId"] = run_id
                    await delegation_context.queue.put(
                        _agent_event_node(
                            context,
                            "MemberRunStarted",
                            **member_fields,
                        )
                    )
                    member_started = True
                await delegation_context.queue.put(
                    _agent_event_node(
                        context,
                        "MemberRunCompleted",
                        **member_fields,
                    )
                )
                if event.content and not result_parts:
                    result_parts.append(event.content)
                return "".join(result_parts) if result_parts else (event.content or "")

            if isinstance(event, RunCancelled):
                delegation_context.cancelled = True
                await delegation_context.queue.put(
                    _agent_event_node(
                        context,
                        "MemberRunError",
                        content="Agent run cancelled",
                        **member_fields,
                    )
                )
                return ""

            if isinstance(event, RunError):
                await delegation_context.queue.put(
                    _agent_event_node(
                        context,
                        "MemberRunError",
                        content=event.message or "Agent run failed",
                        **member_fields,
                    )
                )
                raise RuntimeError(event.message or "Agent run failed")
        else:
            return "".join(result_parts)


def _build_approval_required_events(
    *,
    context: FlowContext,
    runtime_event: ApprovalRequired,
    tool_node_lookup: dict[str, dict[str, str]],
    member_fields: dict[str, Any],
) -> list[NodeEvent]:
    tools_info = [_pending_tool_payload(tool) for tool in runtime_event.tools]
    tool_registry = _get_tool_registry(context)
    for tool_info in tools_info:
        tool_name = str(tool_info.get("toolName") or "")
        if tool_registry is not None and tool_name:
            editable_args = tool_registry.get_editable_args(tool_name)
            if editable_args:
                tool_info["editableArgs"] = editable_args
        _attach_tool_node_metadata(tool_info, tool_node_lookup)

    return [
        _agent_event_node(
            context,
            "ToolApprovalRequired",
            tool={"runId": runtime_event.run_id, "tools": tools_info},
            **member_fields,
        )
    ]


async def _await_and_resolve_approval(
    *,
    context: FlowContext,
    runtime_event: ApprovalRequired,
    tool_node_lookup: dict[str, dict[str, str]],
    member_fields: dict[str, Any],
    owner_run_id: str | None = None,
) -> tuple[ApprovalResponse, list[NodeEvent]]:
    tools_info = [_pending_tool_payload(tool) for tool in runtime_event.tools]

    approval = await _await_approval_response(
        runtime_event.run_id or context.run_id,
        owner_run_id=owner_run_id or context.run_id,
    )
    events: list[NodeEvent] = []
    for tool in tools_info:
        tool_id = str(tool.get("id") or "")
        decision = approval.decisions.get(tool_id)
        if decision is None:
            if approval.cancelled:
                status = "denied"
            else:
                status = "timeout" if not approval.default_approved else "approved"
            resolved_args = tool.get("toolArgs")
        else:
            status = "approved" if decision.approved else "denied"
            resolved_args = decision.edited_args or tool.get("toolArgs")
        resolved_tool = {
            "id": tool_id,
            "toolName": tool.get("toolName"),
            "approvalStatus": status,
            "toolArgs": resolved_args,
        }
        _attach_tool_node_metadata(resolved_tool, tool_node_lookup)
        events.append(
            _agent_event_node(
                context,
                "ToolApprovalResolved",
                tool=resolved_tool,
                **member_fields,
            )
        )

    return approval, events


async def _await_approval_response(
    run_id: str,
    *,
    owner_run_id: str | None = None,
) -> ApprovalResponse:
    approval_event = asyncio.Event()
    run_control.register_approval_waiter(
        run_id, approval_event, owner_run_id=owner_run_id
    )
    try:
        await asyncio.wait_for(approval_event.wait(), timeout=300)
        if run_control.was_approval_cancelled(run_id):
            return ApprovalResponse(run_id=run_id, default_approved=False, cancelled=True)

        response = run_control.get_approval_response(run_id)
        tool_decisions = response.get("tool_decisions", {}) or {}
        edited_args = response.get("edited_args", {}) or {}
        return ApprovalResponse(
            run_id=run_id,
            default_approved=bool(response.get("approved", False)),
            decisions={
                tool_id: ToolDecision(
                    approved=bool(tool_decisions.get(tool_id, response.get("approved", False))),
                    edited_args=(edited_args.get(tool_id) if isinstance(edited_args.get(tool_id), dict) else None),
                )
                for tool_id in tool_decisions
            },
        )
    except TimeoutError:
        return ApprovalResponse(run_id=run_id, default_approved=False)
    finally:
        run_control.clear_approval(run_id)


async def _emit_approval_resolved_events(
    *,
    context: FlowContext,
    approval: ApprovalResponse,
    runtime_event: ApprovalRequired,
    member_fields: dict[str, Any],
    queue: asyncio.Queue[Any],
) -> None:
    for tool in runtime_event.tools:
        decision = approval.decisions.get(tool.tool_call_id)
        if decision is None:
            approved = approval.default_approved
            tool_args = tool.tool_args
            if approval.cancelled:
                status = "denied"
            else:
                status = "timeout" if not approved else "approved"
        else:
            approved = decision.approved
            tool_args = decision.edited_args or tool.tool_args
            status = "approved" if approved else "denied"
        await queue.put(
            _agent_event_node(
                context,
                "ToolApprovalResolved",
                tool={
                    "id": tool.tool_call_id,
                    "toolName": tool.tool_name,
                    "approvalStatus": status,
                    "toolArgs": tool_args,
                },
                **member_fields,
            )
        )


def _root_member_fields(
    *,
    context: FlowContext,
    data: dict[str, Any],
    event: RuntimeEventT,
    force_member_output: bool,
    group_by_node: bool,
    member_name: str,
) -> dict[str, Any]:
    if not force_member_output:
        return {}
    run_id = str(event.member_run_id or event.run_id or "")
    fields = _fallback_member_fields(
        data,
        context,
        run_id,
        AgentExecutor.node_type,
    )
    if not fields:
        return {}
    fields["memberName"] = member_name
    if group_by_node:
        fields["groupByNode"] = True
    return fields


def _runtime_event_types() -> tuple[type[Any], ...]:
    return (
        RunStarted,
        ContentDelta,
        ReasoningStarted,
        ReasoningDelta,
        ReasoningCompleted,
        ToolCallStarted,
        ToolCallCompleted,
        ApprovalRequired,
        ApprovalResolved,
        RunCompleted,
        RunCancelled,
        RunError,
    )


def _agent_event_node(
    context: FlowContext,
    event_name: str,
    **data: Any,
) -> NodeEvent:
    payload = {"event": event_name, **data}
    return NodeEvent(
        node_id=context.node_id,
        node_type=AgentExecutor.node_type,
        event_type="agent_event",
        run_id=context.run_id,
        data=payload,
    )


def _safe_delegation_tool_name(artifact: LinkedAgentArtifact) -> str:
    base = artifact.name.strip() or artifact.node_id or "agent"
    safe = []
    for char in base.lower().replace(" ", "_"):
        safe.append(char if char.isalnum() or char == "_" else "_")
    return f"delegate_{''.join(safe).strip('_') or 'agent'}"


def _delegation_tool_description(artifact: LinkedAgentArtifact) -> str:
    description = artifact.config.description.strip()
    if description:
        return f"Delegate a task to sub-agent '{artifact.name}'. {description}"
    return f"Delegate a task to sub-agent '{artifact.name}'."


def _pending_tool_payload(tool: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": tool.tool_call_id,
        "toolName": tool.tool_name,
        "toolArgs": dict(tool.tool_args or {}),
    }
    if tool.editable_args is not None:
        payload["editableArgs"] = tool.editable_args
    if tool.requires_user_input:
        payload["requiresUserInput"] = True
    if tool.user_input_schema is not None:
        payload["userInputSchema"] = tool.user_input_schema
    return payload


def _tool_payload_from_runtime_call(tool: Any) -> dict[str, Any] | None:
    if tool is None:
        return None
    tool_name = get_original_tool_name(tool.name)
    return {
        "id": tool.id,
        "toolName": tool_name,
        "toolArgs": dict(tool.arguments or {}),
        "isCompleted": False,
        **({"providerData": tool.provider_data} if tool.provider_data else {}),
    }


def _tool_payload_from_runtime_result(tool: Any) -> dict[str, Any] | None:
    if tool is None:
        return None
    tool_name = get_original_tool_name(tool.name)
    payload = {
        "id": tool.id,
        "toolName": tool_name,
        "toolResult": tool.result,
        "failed": bool(tool.failed),
        **({"providerData": tool.provider_data} if tool.provider_data else {}),
    }
    if tool.error is not None:
        payload["error"] = tool.error
    return payload


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


def _coerce_model_options(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    return dict(value)


def _build_node_model_params(
    data: dict[str, Any],
    temperature: float | None,
) -> dict[str, Any]:
    params: dict[str, Any] = {}
    if temperature is not None:
        params["temperature"] = temperature

    for key in (
        "max_tokens",
        "top_p",
        "frequency_penalty",
        "presence_penalty",
        "stop",
    ):
        value = data.get(key)
        if value is not None and value != "":
            params[key] = value

    return params


def _resolve_model(
    model_str: str,
    *,
    node_params: dict[str, Any] | None = None,
    model_options: dict[str, Any] | None = None,
) -> Any:
    if ":" not in model_str:
        raise ValueError(
            f"Invalid model format '{model_str}' — expected 'provider:model_id'"
        )
    provider, model_id = model_str.rsplit(":", 1)
    provider_options = resolve_provider_options(
        provider,
        model_id,
        model_options,
        node_params,
    )
    return get_model(provider, model_id, provider_options=provider_options)


def _split_model_id(model_str: str) -> tuple[str | None, str | None]:
    if ":" not in model_str:
        return None, None
    provider, model_id = model_str.rsplit(":", 1)
    provider = provider.strip()
    model_id = model_id.strip()
    if not provider or not model_id:
        return None, None
    return provider, model_id


def _should_disable_tools(
    model_str: str,
    model_options: dict[str, Any] | None,
) -> bool:
    options = model_options or {}
    if options.get("disable_tools") is True or options.get("disableTools") is True:
        return True

    provider, model_id = _split_model_id(model_str)
    if not provider or not model_id:
        return False

    metadata = get_cached_model_metadata(provider, model_id)
    supports_tools = (
        metadata.get("supports_tools") if isinstance(metadata, dict) else None
    )
    if isinstance(supports_tools, bool):
        return not supports_tools
    return False


async def _resolve_agent_model(
    data: dict[str, Any],
    context: FlowContext,
    *,
    input_value: dict[str, Any] | None,
    model_input: DataValue | None = None,
) -> str:
    model_str = _extract_text(model_input.value) if model_input else ""
    if model_str:
        return model_str

    linked_model = await _resolve_flow_input(context, "model")
    linked_model_str = _extract_text(linked_model) if linked_model is not None else ""
    if linked_model_str:
        return linked_model_str

    variable_model = _resolve_variable_model(context, input_value)
    if variable_model:
        return variable_model

    return str(data.get("model", ""))


def _resolve_variable_model(
    context: FlowContext,
    input_value: dict[str, Any] | None,
) -> str:
    candidates: list[Any] = []
    if isinstance(input_value, dict):
        variables = input_value.get("variables")
        if isinstance(variables, dict):
            candidates.extend(_model_variable_candidates(variables, context.node_id))

    services = context.services
    if services is not None:
        expression_context = getattr(services, "expression_context", None)
        if isinstance(expression_context, dict):
            variables = expression_context.get("variables")
            if isinstance(variables, dict):
                candidates.extend(_model_variable_candidates(variables, context.node_id))

    for candidate in candidates:
        model_str = _extract_text(candidate)
        if model_str:
            return model_str
    return ""


def _model_variable_candidates(
    variables: dict[str, Any],
    node_id: str,
) -> list[Any]:
    node_key = node_model_variable_id(node_id)
    return [variables.get(node_key), variables.get("model")]


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


def _chat_output_policy(context: FlowContext) -> Any | None:
    services = context.services
    if services is None:
        return None
    return getattr(services, "chat_output", None)


def _force_member_output(context: FlowContext) -> bool:
    policy = _chat_output_policy(context)
    if policy is None:
        return False
    if bool(getattr(policy, "group_by_node", False)):
        return True
    primary = getattr(policy, "primary_agent_id", None)
    if not primary:
        return False
    return str(primary) != context.node_id


def _should_group_by_node(context: FlowContext) -> bool:
    policy = _chat_output_policy(context)
    if policy is None:
        return False
    return bool(getattr(policy, "group_by_node", False))


def _resolve_grouped_member_name(
    data: dict[str, Any],
    current_name: Any,
) -> str:
    name = str(current_name or "").strip()
    if not name or name == "Agent":
        candidate = str(data.get("name") or "").strip()
        name = candidate if candidate else "Agent"
    return name


def _fallback_member_fields(
    data: dict[str, Any],
    context: FlowContext,
    run_id: str,
    node_type: str,
) -> dict[str, Any]:
    resolved_run_id = str(run_id or "")
    if not resolved_run_id:
        resolved_run_id = f"{context.run_id}:{context.node_id}".strip(":")
    if not resolved_run_id:
        return {}
    name = str(data.get("name") or "Agent")
    return {
        "memberRunId": resolved_run_id,
        "memberName": name,
        "nodeId": context.node_id,
        "nodeType": node_type,
    }


def _resolve_run_input(
    input_value: dict[str, Any],
    default_message: str,
    messages_override: Any | None = None,
) -> Any:
    if messages_override is not None:
        parsed_override = _coerce_runtime_messages(messages_override)
        if parsed_override:
            return parsed_override

    parsed_messages = _coerce_runtime_messages(input_value.get("runtime_messages"))
    if parsed_messages:
        return parsed_messages

    return default_message


def _resolve_messages_override(data: dict[str, Any]) -> Any | None:
    raw = data.get("messages")
    if raw is None:
        return None

    if isinstance(raw, dict):
        mode = raw.get("mode")
        if mode == "expression":
            return raw.get("expression")
        if mode == "manual":
            return raw.get("messages")

        if "messages" in raw:
            return raw.get("messages")
        if "expression" in raw:
            return raw.get("expression")

    return raw


def _coerce_runtime_messages(value: Any) -> list[RuntimeMessage]:
    if value is None:
        return []

    if isinstance(value, list) and all(isinstance(item, RuntimeMessage) for item in value):
        return list(value)

    if isinstance(value, RuntimeMessage):
        return [value]

    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return []
        return [RuntimeMessage(role="user", content=stripped)]

    if isinstance(value, dict):
        return _coerce_runtime_message_item(value)

    if isinstance(value, list):
        runtime_messages: list[RuntimeMessage] = []
        for item in value:
            runtime_messages.extend(_coerce_runtime_message_item(item))
        return runtime_messages

    return []


def _coerce_runtime_message_item(item: Any) -> list[RuntimeMessage]:
    if isinstance(item, RuntimeMessage):
        return [item]

    if isinstance(item, dict):
        role = str(item.get("role") or "user")
        content = _content_to_text(item.get("content"))
        tool_call_id = item.get("tool_call_id") or item.get("toolCallId")
        tool_calls = item.get("tool_calls") or item.get("toolCalls")
        attachments = item.get("attachments")
        runtime_attachments = _runtime_attachments_from_value(attachments)
        return [
            RuntimeMessage(
                role=role,
                content=content,
                tool_call_id=str(tool_call_id) if tool_call_id else None,
                tool_calls=_runtime_tool_calls_from_message(tool_calls),
                attachments=runtime_attachments,
            )
        ]

    return []


def _runtime_tool_calls_from_message(tool_calls: Any) -> list[RuntimeToolCall]:
    if not isinstance(tool_calls, list):
        return []
    runtime_calls: list[RuntimeToolCall] = []
    for call in tool_calls:
        if not isinstance(call, dict):
            continue
        function = call.get("function") if isinstance(call.get("function"), dict) else {}
        arguments = function.get("arguments")
        parsed_args: dict[str, Any] = {}
        if isinstance(arguments, str):
            try:
                loaded = json.loads(arguments)
                if isinstance(loaded, dict):
                    parsed_args = loaded
            except json.JSONDecodeError:
                parsed_args = {}
        elif isinstance(arguments, dict):
            parsed_args = arguments
        runtime_calls.append(
            RuntimeToolCall(
                id=str(call.get("id") or ""),
                name=str(function.get("name") or ""),
                arguments=parsed_args,
                provider_data=(
                    call.get("providerData")
                    if isinstance(call.get("providerData"), dict)
                    else None
                ),
            )
        )
    return runtime_calls


def _runtime_attachments_from_value(value: Any) -> list[Any]:
    if not isinstance(value, list):
        return []
    attachments: list[Any] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("type") or item.get("kind") or "file")
        path_value = item.get("path")
        if not isinstance(path_value, str) or not path_value:
            continue
        attachments.append(
            RuntimeAttachment(
                kind=kind if kind in {"image", "file", "audio", "video"} else "file",
                path=Path(path_value),
                name=str(item.get("name")) if item.get("name") is not None else None,
            )
        )
    return attachments


def _get_tool_registry(context: FlowContext) -> Any | None:
    services = context.services
    if services is None:
        return None
    return getattr(services, "tool_registry", None)


def _tag_node_artifact(artifact: Any, node_id: str, node_type: str) -> None:
    if artifact is None:
        return
    try:
        setattr(artifact, "__agno_node_id", node_id)
        setattr(artifact, "__agno_node_type", node_type)
    except Exception:
        pass


def _get_tool_name(tool: Any) -> str | None:
    name = getattr(tool, "name", None)
    if isinstance(name, str) and name:
        return name
    name = getattr(tool, "tool_name", None)
    if isinstance(name, str) and name:
        return name
    name = getattr(tool, "__name__", None)
    if isinstance(name, str) and name:
        return name
    return None


def _get_tool_node_meta(tool: Any) -> dict[str, str] | None:
    node_id = getattr(tool, "__agno_node_id", None)
    if not node_id:
        return None
    meta: dict[str, str] = {"nodeId": str(node_id)}
    node_type = getattr(tool, "__agno_node_type", None)
    if isinstance(node_type, str) and node_type:
        meta["nodeType"] = node_type
    return meta


def _build_tool_node_lookup(tools: list[Any]) -> dict[str, dict[str, str]]:
    lookup: dict[str, dict[str, str]] = {}
    for tool in tools:
        name = _get_tool_name(tool)
        meta = _get_tool_node_meta(tool)
        if name and meta:
            if name not in lookup:
                lookup[name] = meta
            original_name = get_original_tool_name(name)
            if original_name not in lookup:
                lookup[original_name] = meta
            if ":" in name:
                short_name = name.split(":")[-1]
                if short_name and short_name not in lookup:
                    lookup[short_name] = meta
    return lookup


def _attach_tool_node_metadata(
    tool_payload: dict[str, Any],
    tool_node_lookup: dict[str, dict[str, str]],
) -> None:
    tool_name = tool_payload.get("toolName")
    if not tool_name:
        return
    meta = tool_node_lookup.get(str(tool_name))
    if not meta:
        return
    tool_payload.setdefault("nodeId", meta.get("nodeId"))
    node_type = meta.get("nodeType")
    if node_type:
        tool_payload.setdefault("nodeType", node_type)


def _resolve_extra_tools(
    context: FlowContext,
    input_value: dict[str, Any] | None,
) -> list[Any]:
    services = context.services
    if services is None:
        return []

    extra_tool_ids = getattr(services, "extra_tool_ids", None)
    if not extra_tool_ids:
        return []

    if not _should_include_extra_tools(context, input_value):
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


def _should_include_extra_tools(
    context: FlowContext,
    input_value: dict[str, Any] | None,
) -> bool:
    del context
    if isinstance(input_value, dict):
        for key in ("include_user_tools", "includeUserTools"):
            if isinstance(input_value.get(key), bool):
                return bool(input_value.get(key))

    return False


def _event_name(event: Any) -> str:
    if isinstance(event, Enum):
        return str(event.value)
    return str(event) if event is not None else ""


executor = AgentExecutor()
