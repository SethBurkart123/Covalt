from __future__ import annotations

import logging
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict
from zynk import StaticFile, UploadFile, command, static, upload

from ..services.agent_manager import get_agent_manager

logger = logging.getLogger(__name__)


# Response models for list view (excludes graph_data)
class AgentInfo(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    icon: Optional[str] = None
    preview_image: Optional[str] = None
    include_user_tools: bool = False
    created_at: str
    updated_at: str


class AgentsListResponse(BaseModel):
    agents: List[AgentInfo]


# Response model for full agent (includes graph_data)
class GraphNode(BaseModel):
    id: str
    type: str
    position: Dict[str, float]
    data: Dict[str, Any]


class GraphEdgeData(BaseModel):
    model_config = ConfigDict(extra="allow")

    sourceType: Optional[str] = None
    targetType: Optional[str] = None
    channel: Optional[str] = None


class GraphEdge(BaseModel):
    id: str
    source: str
    sourceHandle: Optional[str] = None
    target: str
    targetHandle: Optional[str] = None
    data: Optional[GraphEdgeData] = None


class GraphData(BaseModel):
    nodes: List[GraphNode]
    edges: List[GraphEdge]


class AgentDetailResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    icon: Optional[str] = None
    preview_image: Optional[str] = None
    graph_data: GraphData
    created_at: str
    updated_at: str


# Request models
class CreateAgentRequest(BaseModel):
    name: str
    description: Optional[str] = None
    icon: Optional[str] = None


class CreateAgentResponse(BaseModel):
    id: str


class AgentIdRequest(BaseModel):
    id: str


class UpdateAgentRequest(BaseModel):
    id: str
    name: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None


class SaveAgentGraphRequest(BaseModel):
    id: str
    nodes: List[GraphNode]
    edges: List[GraphEdge]


class UploadAgentImageRequest(BaseModel):
    agent_id: str


@command
async def list_agents() -> AgentsListResponse:
    """List all agents (for grid view)."""
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
    """Get a single agent with full graph data."""
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
    """Create a new agent with default graph."""
    manager = get_agent_manager()
    agent_id = manager.create_agent(
        name=body.name,
        description=body.description,
        icon=body.icon,
    )
    return CreateAgentResponse(id=agent_id)


@command
async def update_agent(body: UpdateAgentRequest) -> Dict[str, bool]:
    """Update agent metadata (name, description, icon)."""
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
async def save_agent_graph(body: SaveAgentGraphRequest) -> Dict[str, bool]:
    """Save agent graph data (autosave endpoint)."""
    manager = get_agent_manager()

    # Convert pydantic models to dicts
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
async def delete_agent(body: AgentIdRequest) -> Dict[str, bool]:
    """Delete an agent."""
    manager = get_agent_manager()
    success = manager.delete_agent(body.id)
    if not success:
        raise ValueError(f"Agent '{body.id}' not found")
    return {"success": True}


MAX_IMAGE_SIZE = "10MB"
ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]


@upload(max_size=MAX_IMAGE_SIZE, allowed_types=ALLOWED_IMAGE_TYPES)
async def upload_agent_icon(file: UploadFile, agent_id: str) -> Dict[str, str]:
    """Upload a custom icon image for an agent."""
    manager = get_agent_manager()
    icon_value = manager.update_icon(
        agent_id=agent_id,
        image_data=await file.read(),
        filename=file.filename or "icon.png",
    )
    return {"icon": icon_value}


@upload(max_size=MAX_IMAGE_SIZE, allowed_types=ALLOWED_IMAGE_TYPES)
async def upload_agent_preview(file: UploadFile, agent_id: str) -> Dict[str, bool]:
    """Upload a preview screenshot for an agent."""
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
    """Serve agent files (icons and previews)."""
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
