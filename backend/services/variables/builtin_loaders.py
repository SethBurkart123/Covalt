"""In-tree option loaders. Plugins register their own via `register_options_loader`."""

from __future__ import annotations

from typing import Any

from backend.services.flows.agent_manager import get_agent_manager
from backend.services.models.model_factory import stream_available_model_batches

from .options_registry import register_options_loader


async def _list_models(_params: dict[str, Any]) -> list[dict[str, Any]]:
    options: list[dict[str, Any]] = []
    async for provider, models, _is_final in stream_available_model_batches():
        for model in models:
            model_id = str(model.get("modelId") or "")
            if not model_id:
                continue
            display = str(model.get("displayName") or model_id)
            options.append(
                {
                    "value": f"{provider}:{model_id}",
                    "label": display,
                    "group": provider,
                }
            )
    options.sort(key=lambda opt: (str(opt.get("group") or ""), str(opt.get("label") or "")))
    return options


async def _list_agents(_params: dict[str, Any]) -> list[dict[str, Any]]:
    options: list[dict[str, Any]] = []
    try:
        agents = get_agent_manager().list_agents()
    except Exception:
        return options

    for agent in agents:
        if not isinstance(agent, dict):
            continue
        agent_id = str(agent.get("id") or "")
        if not agent_id:
            continue
        options.append(
            {
                "value": f"agent:{agent_id}",
                "label": str(agent.get("name") or agent_id),
                "group": "Agents",
            }
        )
    options.sort(key=lambda opt: str(opt.get("label") or ""))
    return options


def register_builtin_loaders() -> None:
    register_options_loader("models:list", _list_models)
    register_options_loader("agents:list", _list_agents)
