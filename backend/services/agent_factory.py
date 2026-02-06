from __future__ import annotations

from typing import List, Union

from agno.agent import Agent
from agno.db.in_memory import InMemoryDb
from agno.team import Team

from .. import db
from .model_factory import get_model
from .tool_registry import get_tool_registry

_agent_db = InMemoryDb()


def create_agent_for_chat(
    chat_id: str,
    tool_ids: List[str] = [],
) -> Union[Agent, Team]:
    with db.db_session() as sess:
        config = db.get_chat_agent_config(sess, chat_id)
        if not config:
            config = db.get_default_agent_config()
            db.update_chat_agent_config(sess, chatId=chat_id, config=config)
        system_prompt = db.get_system_prompt_setting(sess)

    agent_id = config.get("agent_id")
    if agent_id:
        from .agent_manager import get_agent_manager
        from .graph_executor import build_agent_from_graph

        agent_manager = get_agent_manager()
        agent_data = agent_manager.get_agent(agent_id)
        if agent_data:
            result = build_agent_from_graph(
                agent_data["graph_data"],
                chat_id=chat_id,
                extra_tool_ids=tool_ids or None,
            )
            return result.agent

    provider = config.get("provider", "openai")
    model_id = config.get("model_id")
    chat_instructions = config.get("instructions", [])
    name = config.get("name", "Assistant")
    description = config.get("description", "You are a helpful AI assistant.")

    instructions = []
    if system_prompt:
        instructions.append(system_prompt)
    if chat_instructions:
        instructions.extend(chat_instructions)

    if not model_id:
        raise RuntimeError("Model ID is required in agent configuration")

    model = get_model(provider, model_id)
    tool_registry = get_tool_registry()
    tools = (
        tool_registry.resolve_tool_ids(tool_ids, chat_id=chat_id) if tool_ids else None
    )

    return Agent(
        name=name,
        model=model,
        tools=tools,
        description=description,
        instructions=instructions or None,
        markdown=True,
        stream_intermediate_steps=True,
        db=_agent_db,
    )


def update_agent_tools(chat_id: str, tool_ids: List[str]) -> None:
    with db.db_session() as sess:
        config = db.get_chat_agent_config(sess, chat_id)
        if not config:
            config = db.get_default_agent_config()

        config["tool_ids"] = tool_ids
        db.update_chat_agent_config(sess, chatId=chat_id, config=config)


def update_agent_model(chat_id: str, provider: str, model_id: str) -> None:
    with db.db_session() as sess:
        config = db.get_chat_agent_config(sess, chat_id)
        if not config:
            config = db.get_default_agent_config()

        config["provider"] = provider
        config["model_id"] = model_id
        db.update_chat_agent_config(sess, chatId=chat_id, config=config)
