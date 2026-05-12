from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel, Field
from zynk import command

from nodes import get_executor
from nodes._variables import variable_spec_to_dict
from nodes.core.chat_start.variables_runtime import collect_specs_from_graph

from ..services.chat.chat_graph_config import get_graph_data_for_chat
from ..services.flows.agent_manager import get_agent_manager
from ..services.variables import (
    resolve_options_via_callback,
    resolve_options_via_link,
)

logger = logging.getLogger(__name__)


class VariableOption(BaseModel):
    value: Any
    label: str
    group: str | None = None
    icon: str | None = None


class ResolveCallbackOptionsRequest(BaseModel):
    load: str
    params: dict[str, Any] = Field(default_factory=dict)


class ResolveCallbackOptionsResponse(BaseModel):
    options: list[VariableOption]


class ResolveLinkOptionsRequest(BaseModel):
    graphData: dict[str, Any]
    nodeId: str
    handle: str


class ResolveLinkOptionsResponse(BaseModel):
    options: list[VariableOption]


@command
async def resolve_variable_options_callback(
    body: ResolveCallbackOptionsRequest,
) -> ResolveCallbackOptionsResponse:
    try:
        raw = await resolve_options_via_callback(body.load, body.params)
    except KeyError:
        logger.warning("Unknown options loader requested: %s", body.load)
        return ResolveCallbackOptionsResponse(options=[])
    except Exception:
        logger.exception("Options loader '%s' failed", body.load)
        return ResolveCallbackOptionsResponse(options=[])
    return ResolveCallbackOptionsResponse(options=[VariableOption(**option) for option in raw])


@command
async def resolve_variable_options_link(
    body: ResolveLinkOptionsRequest,
) -> ResolveLinkOptionsResponse:
    try:
        raw = await resolve_options_via_link(body.graphData, body.nodeId, body.handle)
    except Exception:
        logger.exception(
            "Link options resolution failed for node=%s handle=%s",
            body.nodeId,
            body.handle,
        )
        return ResolveLinkOptionsResponse(options=[])
    return ResolveLinkOptionsResponse(options=[VariableOption(**option) for option in raw])


class GetChatVariableSpecsRequest(BaseModel):
    chatId: str | None = None
    modelId: str | None = None
    agentId: str | None = None
    graphData: dict[str, Any] | None = None


class GetChatVariableSpecsResponse(BaseModel):
    specs: list[dict[str, Any]]
    nodeId: str | None = None
    graphData: dict[str, Any] | None = None


def _resolve_specs_from_graph(graph_data: dict[str, Any]) -> tuple[list[dict[str, Any]], str | None]:
    specs, chat_start_id = collect_specs_from_graph(graph_data, get_executor=get_executor)
    return [variable_spec_to_dict(spec) for spec in specs], chat_start_id


def _agent_graph_data(agent_id: str) -> dict[str, Any] | None:
    agent = get_agent_manager().get_agent(agent_id)
    if not isinstance(agent, dict):
        return None
    graph_data = agent.get("graph_data")
    return graph_data if isinstance(graph_data, dict) else None


@command
async def get_chat_variable_specs(
    body: GetChatVariableSpecsRequest,
) -> GetChatVariableSpecsResponse:
    """Resolve merged variable specs for a chat or agent, including unsaved test graphs."""
    graph_data = body.graphData if isinstance(body.graphData, dict) else None

    agent_id = body.agentId
    if not agent_id and body.modelId and body.modelId.startswith("agent:"):
        agent_id = body.modelId[len("agent:"):]

    if graph_data is None and agent_id:
        graph_data = _agent_graph_data(agent_id)

    if graph_data is None and (body.chatId or body.modelId):
        try:
            graph_data = get_graph_data_for_chat(
                body.chatId, body.modelId, model_options={}
            )
        except Exception:
            logger.exception(
                "Failed to load graph data for chat=%s model=%s",
                body.chatId,
                body.modelId,
            )
            graph_data = None

    if graph_data is None:
        return GetChatVariableSpecsResponse(specs=[], nodeId=None, graphData=None)

    specs, node_id = _resolve_specs_from_graph(graph_data)
    return GetChatVariableSpecsResponse(specs=specs, nodeId=node_id, graphData=graph_data)
