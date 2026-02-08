"""Agent node — builds Agno Agent or Team (structural) and runs it (flow).

Hybrid executor:
  build()   → Phase 1: compose Agent/Team from tools + sub-agents
  execute() → Phase 2: run agent with input, stream events, produce response
"""

from __future__ import annotations

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


class AgentExecutor:
    node_type = "agent"

    # ── Phase 1: structural composition ─────────────────────────────

    def build(self, data: dict[str, Any], context: BuildContext) -> AgentResult:
        model = _resolve_model(data)
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
        """Run the agent with input data, streaming events and producing response text."""
        input_value = inputs.get("input", DataValue("text", "")).value
        # Normalize: message dicts → extract content, everything else → str
        if isinstance(input_value, dict):
            message = input_value.get("content", str(input_value))
        else:
            message = str(input_value) if input_value else ""

        # Use agent from Phase 1 if available, otherwise build a minimal one
        agent = context.agent
        if agent is None:
            model = _resolve_model(data)
            instructions = [data["instructions"]] if data.get("instructions") else None
            agent = Agent(
                name=data.get("name", "Agent"),
                model=model,
                description=data.get("description", ""),
                instructions=instructions,
                markdown=True,
                stream_events=True,
                db=_agent_db,
            )

        yield NodeEvent(
            node_id=context.node_id,
            node_type=self.node_type,
            event_type="started",
            run_id=context.run_id,
            data={"agent": data.get("name", "Agent")},
        )

        try:
            response = await agent.arun(message)
            content = response.content if response else ""

            yield ExecutionResult(
                outputs={"response": DataValue(type="text", value=content or "")}
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
                outputs={"response": DataValue(type="text", value="")}
            )


def _resolve_model(data: dict[str, Any]) -> Any:
    model_str = data.get("model", "")
    if ":" not in model_str:
        raise ValueError(
            f"Invalid model format '{model_str}' — expected 'provider:model_id'"
        )
    provider, model_id = model_str.split(":", 1)
    return get_model(provider, model_id)


def _collect_tools(context: BuildContext) -> list[Any]:
    tools: list[Any] = []
    for source in context.tool_sources:
        tools.extend(source.get("tools", []))
    return tools


executor = AgentExecutor()
