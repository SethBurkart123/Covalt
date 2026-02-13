from __future__ import annotations

import json
import logging
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from ..config import get_db_directory
from ..db import db_session
from ..db.models import Agent
from .graph_normalizer import normalize_graph_data

logger = logging.getLogger(__name__)


def get_agents_directory() -> Path:
    agents_dir = get_db_directory() / "agents"
    agents_dir.mkdir(parents=True, exist_ok=True)
    return agents_dir


def get_agent_directory(agent_id: str) -> Path:
    agent_dir = get_agents_directory() / agent_id
    agent_dir.mkdir(parents=True, exist_ok=True)
    return agent_dir


# Default graph: Chat Start -> Agent
DEFAULT_GRAPH = {
    "nodes": [
        {
            "id": "chat-start-1",
            "type": "chat-start",
            "position": {"x": 100, "y": 200},
            "data": {},
        },
        {
            "id": "agent-1",
            "type": "agent",
            "position": {"x": 400, "y": 200},
            "data": {},
        },
    ],
    "edges": [
        {
            "id": "e1",
            "source": "chat-start-1",
            "sourceHandle": "output",
            "target": "agent-1",
            "targetHandle": "input",
            "data": {
                "sourceType": "data",
                "targetType": "data",
                "channel": "flow",
            },
        },
    ],
}


class AgentManager:
    def __init__(self) -> None:
        self.agents_dir = get_agents_directory()

    def list_agents(self) -> list[dict[str, Any]]:
        """List all agents (for grid view, excludes graph_data)."""
        with db_session() as sess:
            agents = sess.query(Agent).order_by(Agent.updated_at.desc()).all()
            results = []
            for a in agents:
                include_user_tools = False
                try:
                    graph = json.loads(a.graph_data)
                    for node in graph.get("nodes", []):
                        if node.get("type") == "chat-start":
                            include_user_tools = bool(
                                node.get("data", {}).get("includeUserTools", False)
                            )
                            break
                except (json.JSONDecodeError, TypeError):
                    pass
                results.append(
                    {
                        "id": a.id,
                        "name": a.name,
                        "description": a.description,
                        "icon": a.icon,
                        "preview_image": a.preview_image,
                        "include_user_tools": include_user_tools,
                        "created_at": a.created_at,
                        "updated_at": a.updated_at,
                    }
                )
            return results

    def get_agent(self, agent_id: str) -> dict[str, Any] | None:
        """Get a single agent with full graph data."""
        with db_session() as sess:
            agent = sess.query(Agent).filter(Agent.id == agent_id).first()
            if not agent:
                return None

            raw_graph = json.loads(agent.graph_data)
            graph = normalize_graph_data(
                raw_graph.get("nodes", []), raw_graph.get("edges", [])
            )
            return {
                "id": agent.id,
                "name": agent.name,
                "description": agent.description,
                "icon": agent.icon,
                "preview_image": agent.preview_image,
                "graph_data": graph,
                "created_at": agent.created_at,
                "updated_at": agent.updated_at,
            }

    def create_agent(
        self,
        name: str,
        description: str | None = None,
        icon: str | None = None,
    ) -> str:
        """Create a new agent with default Chat Start -> Agent graph."""
        agent_id = str(uuid.uuid4())
        now = datetime.now().isoformat()
        default_graph = normalize_graph_data(
            DEFAULT_GRAPH["nodes"], DEFAULT_GRAPH["edges"]
        )

        with db_session() as sess:
            agent = Agent(
                id=agent_id,
                name=name,
                description=description,
                icon=icon,
                graph_data=json.dumps(default_graph),
                created_at=now,
                updated_at=now,
            )
            sess.add(agent)
            sess.commit()

        logger.info(f"Created agent '{name}' with id '{agent_id}'")
        return agent_id

    def update_agent(
        self,
        agent_id: str,
        name: str | None = None,
        description: str | None = None,
        icon: str | None = None,
    ) -> bool:
        """Update agent metadata (not graph data)."""
        with db_session() as sess:
            agent = sess.query(Agent).filter(Agent.id == agent_id).first()
            if not agent:
                return False

            if name is not None:
                agent.name = name
            if description is not None:
                agent.description = description
            if icon is not None:
                agent.icon = icon

            agent.updated_at = datetime.now().isoformat()
            sess.commit()

        logger.info(f"Updated agent '{agent_id}'")
        return True

    def save_graph(
        self,
        agent_id: str,
        nodes: list[dict[str, Any]],
        edges: list[dict[str, Any]],
    ) -> bool:
        """Save the graph data (autosave endpoint)."""
        normalized_graph = normalize_graph_data(nodes, edges)

        with db_session() as sess:
            agent = sess.query(Agent).filter(Agent.id == agent_id).first()
            if not agent:
                return False

            agent.graph_data = json.dumps(normalized_graph)
            agent.updated_at = datetime.now().isoformat()
            sess.commit()

        logger.debug(f"Saved graph for agent '{agent_id}'")
        return True

    def update_preview(self, agent_id: str, image_data: bytes, filename: str) -> bool:
        """Update the preview screenshot for an agent."""
        with db_session() as sess:
            agent = sess.query(Agent).filter(Agent.id == agent_id).first()
            if not agent:
                return False

            # Save to filesystem
            agent_dir = get_agent_directory(agent_id)
            ext = Path(filename).suffix or ".png"
            preview_filename = f"preview{ext}"
            preview_path = agent_dir / preview_filename
            preview_path.write_bytes(image_data)

            # Update database
            agent.preview_image = preview_filename
            agent.updated_at = datetime.now().isoformat()
            sess.commit()

        logger.info(f"Updated preview for agent '{agent_id}'")
        return True

    def update_icon(self, agent_id: str, image_data: bytes, filename: str) -> str:
        """Update the icon image for an agent. Returns the icon string."""
        with db_session() as sess:
            agent = sess.query(Agent).filter(Agent.id == agent_id).first()
            if not agent:
                raise ValueError(f"Agent '{agent_id}' not found")

            # Save to filesystem
            agent_dir = get_agent_directory(agent_id)
            ext = Path(filename).suffix or ".png"
            icon_filename = f"icon{ext}"
            icon_path = agent_dir / icon_filename
            icon_path.write_bytes(image_data)

            # Update database with image: prefix
            icon_value = f"image:{icon_filename}"
            agent.icon = icon_value
            agent.updated_at = datetime.now().isoformat()
            sess.commit()

        logger.info(f"Updated icon for agent '{agent_id}'")
        return icon_value

    def delete_agent(self, agent_id: str) -> bool:
        """Delete an agent and its files."""
        with db_session() as sess:
            agent = sess.query(Agent).filter(Agent.id == agent_id).first()
            if not agent:
                return False

            sess.delete(agent)
            sess.commit()

        # Remove files
        agent_dir = get_agents_directory() / agent_id
        if agent_dir.exists():
            shutil.rmtree(agent_dir)

        logger.info(f"Deleted agent '{agent_id}'")
        return True

    def get_agent_file_path(self, agent_id: str, filename: str) -> Path | None:
        """Get the full path to an agent's file (icon or preview)."""
        agent_dir = get_agents_directory() / agent_id
        file_path = agent_dir / filename
        if file_path.exists():
            return file_path
        return None


_agent_manager: AgentManager | None = None


def get_agent_manager() -> AgentManager:
    global _agent_manager
    if _agent_manager is None:
        _agent_manager = AgentManager()
    return _agent_manager
