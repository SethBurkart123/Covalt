from __future__ import annotations

import logging
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict
from zynk import StaticFile, UploadFile, command, static, upload

from ..services.agent_manager import get_agent_manager

logger = logging.getLogger(__name__)


class AgentInfo(BaseModel):
    id: str
    name: str
    description: str | None = None
    icon: str | None = None
    preview_image: str | None = None
    include_user_tools: bool = False
    created_at: str
    updated_at: str


class AgentsListResponse(BaseModel):
    agents: list[AgentInfo]


class GraphNode(BaseModel):
    id: str
    type: str
    position: dict[str, float]
    data: dict[str, Any]


class GraphEdgeData(BaseModel):
    model_config = ConfigDict(extra="allow")

    sourceType: str | None = None
    targetType: str | None = None
    channel: Literal["flow", "link"]


class GraphEdge(BaseModel):
    id: str
    source: str
    sourceHandle: str | None = None
    target: str
    targetHandle: str | None = None
    data: GraphEdgeData


class GraphData(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


class AgentDetailResponse(BaseModel):
    id: str
    name: str
    description: str | None = None
    icon: str | None = None
    preview_image: str | None = None
    graph_data: GraphData
    created_at: str
    updated_at: str


class CreateAgentRequest(BaseModel):
    name: str
    description: str | None = None
    icon: str | None = None


class CreateAgentResponse(BaseModel):
    id: str


class AgentIdRequest(BaseModel):
    id: str


class UpdateAgentRequest(BaseModel):
    id: str
    name: str | None = None
    description: str | None = None
    icon: str | None = None


class SaveAgentGraphRequest(BaseModel):
    id: str
    nodes: list[GraphNode]
    edges: list[GraphEdge]


class UploadAgentImageRequest(BaseModel):
    agent_id: str


@command
async def list_agents() -> AgentsListResponse:
    manager = get_agent_manager()
    agents = manager.list_agents()

    return AgentsListResponse(
        agents=[
            AgentInfo(
                id=a["id"],
                name=a["name"],
                description=a.get("description"),
                icon=a.get("icon"),
                preview_image=a.get("preview_image"),
                include_user_tools=a.get("include_user_tools", False),
                created_at=a["created_at"],
                updated_at=a["updated_at"],
            )
            for a in agents
        ]
    )


@command
async def get_agent(body: AgentIdRequest) -> AgentDetailResponse:
    manager = get_agent_manager()
    agent = manager.get_agent(body.id)

    if agent is None:
        raise ValueError(f"Agent '{body.id}' not found")

    graph = agent["graph_data"]
    return AgentDetailResponse(
        id=agent["id"],
        name=agent["name"],
        description=agent.get("description"),
        icon=agent.get("icon"),
        preview_image=agent.get("preview_image"),
        graph_data=GraphData(
            nodes=[
                GraphNode(
                    id=n["id"],
                    type=n["type"],
                    position=n["position"],
                    data=n.get("data", {}),
                )
                for n in graph.get("nodes", [])
            ],
            edges=[
                GraphEdge(
                    id=e["id"],
                    source=e["source"],
                    sourceHandle=e.get("sourceHandle"),
                    target=e["target"],
                    targetHandle=e.get("targetHandle"),
                    data=e.get("data"),
                )
                for e in graph.get("edges", [])
            ],
        ),
        created_at=agent["created_at"],
        updated_at=agent["updated_at"],
    )


@command
async def create_agent(body: CreateAgentRequest) -> CreateAgentResponse:
    manager = get_agent_manager()
    agent_id = manager.create_agent(
        name=body.name,
        description=body.description,
        icon=body.icon,
    )
    return CreateAgentResponse(id=agent_id)


@command
async def update_agent(body: UpdateAgentRequest) -> dict[str, bool]:
    manager = get_agent_manager()
    success = manager.update_agent(
        agent_id=body.id,
        name=body.name,
        description=body.description,
        icon=body.icon,
    )
    if not success:
        raise ValueError(f"Agent '{body.id}' not found")
    return {"success": True}


@command
async def save_agent_graph(body: SaveAgentGraphRequest) -> dict[str, bool]:
    manager = get_agent_manager()

    nodes = [n.model_dump() for n in body.nodes]
    edges = [e.model_dump() for e in body.edges]

    success = manager.save_graph(
        agent_id=body.id,
        nodes=nodes,
        edges=edges,
    )
    if not success:
        raise ValueError(f"Agent '{body.id}' not found")
    return {"success": True}


@command
async def delete_agent(body: AgentIdRequest) -> dict[str, bool]:
    manager = get_agent_manager()
    success = manager.delete_agent(body.id)
    if not success:
        raise ValueError(f"Agent '{body.id}' not found")
    return {"success": True}


MAX_IMAGE_SIZE = "10MB"
ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]


@upload(max_size=MAX_IMAGE_SIZE, allowed_types=ALLOWED_IMAGE_TYPES)
async def upload_agent_icon(file: UploadFile, agent_id: str) -> dict[str, str]:
    manager = get_agent_manager()
    icon_value = manager.update_icon(
        agent_id=agent_id,
        image_data=await file.read(),
        filename=file.filename or "icon.png",
    )
    return {"icon": icon_value}


@upload(max_size=MAX_IMAGE_SIZE, allowed_types=ALLOWED_IMAGE_TYPES)
async def upload_agent_preview(file: UploadFile, agent_id: str) -> dict[str, bool]:
    manager = get_agent_manager()
    success = manager.update_preview(
        agent_id=agent_id,
        image_data=await file.read(),
        filename=file.filename or "preview.png",
    )
    if not success:
        raise ValueError(f"Agent '{agent_id}' not found")
    return {"success": True}


@static
async def agent_file(
    agent_id: str, file_type: Literal["icon", "preview"]
) -> StaticFile:
    manager = get_agent_manager()
    agent = manager.get_agent(agent_id)

    if agent is None:
        raise FileNotFoundError(f"Agent '{agent_id}' not found")

    if file_type == "preview":
        filename = agent.get("preview_image")
    else:  # icon
        icon = agent.get("icon", "")
        filename = icon.replace("image:", "") if icon.startswith("image:") else None

    if not filename:
        raise FileNotFoundError(f"No {file_type} found for agent")

    file_path = manager.get_agent_file_path(agent_id, filename)
    if not file_path:
        raise FileNotFoundError(f"File not found: {filename}")

    return StaticFile(path=file_path)
