"""Agent node — builds Agno Agent or Team from graph data."""

from __future__ import annotations
from typing import Any

from agno.agent import Agent
from agno.db.in_memory import InMemoryDb
from agno.team import Team

from backend.services.model_factory import get_model
from nodes._types import AgentResult, BuildContext

_agent_db = InMemoryDb()


class AgentExecutor:
    node_type = "agent"

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
