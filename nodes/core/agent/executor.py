"""Agent node — builds Agno Agent or Team (structural) and runs it (flow).

Hybrid executor:
  build()   → Phase 1: compose Agent/Team from tools + sub-agents
  execute() → Phase 2: run agent with input, stream events, produce response
"""

from __future__ import annotations

import asyncio
from enum import Enum
from typing import Any

from agno.agent import Agent
from agno.db.in_memory import InMemoryDb
from agno.team import Team

from backend.services.model_factory import get_model
from nodes._types import (
    AgentResult,
    BuildContext,
    DataValue,
    ExecutionResult,
    FlowContext,
    NodeEvent,
)

_agent_db = InMemoryDb()
AGENT_STREAM_IDLE_TIMEOUT_SECONDS = 20.0


class AgentExecutor:
    node_type = "agent"

    # ── Phase 1: structural composition ─────────────────────────────

    def build(self, data: dict[str, Any], context: BuildContext) -> AgentResult:
        model = _resolve_model(
            str(data.get("model", "")), _coerce_optional_float(data.get("temperature"))
        )
        tools = _collect_tools(context)
        instructions = [data["instructions"]] if data.get("instructions") else None

        if not context.sub_agents:
            return AgentResult(
                agent=Agent(
                    name=data.get("name", "Agent"),
                    model=model,
                    tools=tools or None,
                    description=data.get("description", ""),
                    instructions=instructions,
                    markdown=True,
                    stream_events=True,
                    db=_agent_db,
                )
            )

        return AgentResult(
            agent=Team(
                name=data.get("name", "Agent"),
                model=model,
                tools=tools or None,
                description=data.get("description", ""),
                instructions=instructions,
                members=context.sub_agents,
                markdown=True,
                stream_events=True,
                stream_member_events=True,
                db=_agent_db,
            )
        )

    # ── Phase 2: flow execution ─────────────────────────────────────

    async def execute(
        self, data: dict[str, Any], inputs: dict[str, DataValue], context: FlowContext
    ):
        input_dv = inputs.get("input", DataValue("data", {}))
        raw = input_dv.value
        input_value = raw if isinstance(raw, dict) else {"message": str(raw)}

        message = _extract_text(input_value)

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

        agent = context.agent
        if agent is None:
            model = _resolve_model(model_str, temperature)
            agent = Agent(
                name=data.get("name", "Agent"),
                model=model,
                description=data.get("description", ""),
                instructions=instructions,
                markdown=True,
                stream_events=True,
                db=_agent_db,
            )
        else:
            if model_str:
                agent.model = _resolve_model(model_str, temperature)
            if hasattr(agent, "instructions"):
                agent.instructions = instructions

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

            stream = agent.arun(message, stream=True, stream_events=True).__aiter__()

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

                if event_name in {"RunContent", "TeamRunContent"}:
                    token = str(getattr(chunk, "content", "") or "")
                    if token:
                        content_parts.append(token)
                        yield NodeEvent(
                            node_id=context.node_id,
                            node_type=self.node_type,
                            event_type="progress",
                            run_id=context.run_id,
                            data={"token": token},
                        )
                    continue

                if event_name in {"RunCompleted", "TeamRunCompleted"}:
                    if not content_parts:
                        fallback_final = str(getattr(chunk, "content", "") or "")
                    break

                if event_name in {"RunError", "TeamRunError"}:
                    raise RuntimeError(
                        str(getattr(chunk, "content", None) or "Agent run failed")
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


def _collect_tools(context: BuildContext) -> list[Any]:
    tools: list[Any] = []
    for source in context.tool_sources:
        tools.extend(source.get("tools", []))
    return tools


executor = AgentExecutor()
