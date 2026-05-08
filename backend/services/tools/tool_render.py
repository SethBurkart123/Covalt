from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from nodes._registry import get_executor as _get_node_executor
from nodes._renderers import resolve_default_renderer

from ... import db
from ...db.models import ToolCall as DbToolCall
from ...models.chat import ToolCallPayload
from ..renderers.registry import find_descriptor_by_tool_name
from ..workspace_manager import get_workspace_manager
from .render_plan_builder import get_render_plan_builder
from .tool_registry import get_tool_registry
from .toolset_executor import get_toolset_executor

logger = logging.getLogger(__name__)
registry = get_tool_registry()


def is_toolset_tool(tool_name: str) -> bool:
    return (
        ":" in tool_name
        and not tool_name.startswith("mcp:")
        and not tool_name.startswith("-")
    )


def _load_tool_call_render_plan(tool_call_id: str | None) -> dict[str, Any] | None:
    if not tool_call_id:
        return None
    try:
        with db.db_session() as sess:
            tool_call = sess.query(DbToolCall).filter(DbToolCall.id == tool_call_id).first()
            if tool_call and tool_call.render_plan:
                return json.loads(tool_call.render_plan)
            if tool_call and not tool_call.render_plan:
                logger.warning("Tool call %s missing render_plan in db.", tool_call_id)
            if not tool_call:
                logger.warning("Tool call %s not found in db.", tool_call_id)
    except Exception as exc:
        logger.warning("Failed to load render plan for tool call %s: %s", tool_call_id, exc)
    return None


def _did_tool_call_fail(tool_name: str, tool_call_id: str | None) -> bool:
    if not tool_call_id or not tool_name or not is_toolset_tool(tool_name):
        return False

    try:
        with db.db_session() as sess:
            tool_call = sess.query(DbToolCall).filter(DbToolCall.id == tool_call_id).first()
            if not tool_call:
                return False
            return tool_call.status == "error"
    except Exception as exc:
        logger.warning("Failed to load status for tool call %s: %s", tool_call_id, exc)
        return False


def _parse_tool_result(tool_result: Any) -> Any:
    if tool_result is None:
        return None
    if isinstance(tool_result, str):
        try:
            return json.loads(tool_result)
        except json.JSONDecodeError:
            return tool_result
    return tool_result


def _has_unresolved_render_ref(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().startswith("$")
    if isinstance(value, dict):
        return any(_has_unresolved_render_ref(v) for v in value.values())
    if isinstance(value, list):
        return any(_has_unresolved_render_ref(v) for v in value)
    return False


def _is_invalid_render_plan(render_plan: dict[str, Any] | None) -> bool:
    if render_plan is None:
        return False
    if not isinstance(render_plan, dict):
        return True

    config = render_plan.get("config")
    if not isinstance(config, dict):
        return False

    for key in ("file", "path", "url", "artifact"):
        if key in config and _has_unresolved_render_ref(config.get(key)):
            return True

    return False


def _resolve_tool_render_plan(
    *,
    tool_name: str,
    tool_args: dict[str, Any] | None,
    tool_result: Any,
    tool_call_id: str | None,
    chat_id: str | None,
    provided_plan: dict[str, Any] | None = None,
    failed: bool = False,
    node_type: str | None = None,
) -> dict[str, Any] | None:
    if failed:
        return None

    if provided_plan is not None:
        return provided_plan

    render_plan = None
    if tool_name and is_toolset_tool(tool_name):
        if tool_call_id:
            render_plan = get_toolset_executor().consume_render_plan(tool_call_id)
        if render_plan is None and tool_call_id:
            render_plan = _load_tool_call_render_plan(tool_call_id)
        if render_plan is None:
            render_plan = _generate_toolset_render_plan(
                tool_name=tool_name,
                tool_args=tool_args,
                tool_result=tool_result,
                chat_id=chat_id,
            )

    if render_plan is None and tool_name:
        renderer = registry.get_renderer(tool_name)
        if renderer:
            render_plan = {"renderer": renderer, "config": {}}

    if render_plan is None and tool_name and node_type:
        executor = _get_node_executor(node_type)
        default_map = getattr(executor, "default_renderers", None) if executor else None
        key = resolve_default_renderer(default_map, tool_name)
        if key:
            render_plan = {"renderer": key, "config": {}}

    if render_plan is None and tool_name:
        descriptor = find_descriptor_by_tool_name(tool_name)
        if descriptor is not None:
            render_plan = {"renderer": descriptor.key, "config": {}}

    return render_plan


def _build_tool_call_completed_payload(
    *,
    tool_id: str,
    tool_name: str,
    tool_args: dict[str, Any] | None,
    tool_result: Any,
    provider_data: dict[str, Any] | None = None,
    render_plan: dict[str, Any] | None = None,
    chat_id: str | None = None,
    failed: bool = False,
    node_type: str | None = None,
) -> dict[str, Any]:
    safe_args = tool_args if isinstance(tool_args, dict) else {}
    tool_result_text = str(tool_result) if tool_result is not None else None
    resolved_plan = _resolve_tool_render_plan(
        tool_name=tool_name,
        tool_args=safe_args,
        tool_result=tool_result,
        tool_call_id=tool_id or None,
        chat_id=chat_id,
        provided_plan=render_plan,
        failed=failed,
        node_type=node_type,
    )

    if failed or _is_invalid_render_plan(resolved_plan):
        resolved_plan = None
        failed = True
    tool_block: dict[str, Any] = {
        "id": tool_id,
        "toolName": tool_name,
        "toolArgs": safe_args,
        "toolResult": tool_result_text,
        "isCompleted": True,
    }
    if failed:
        tool_block["failed"] = True
    if provider_data:
        tool_block["providerData"] = provider_data
    if resolved_plan is not None:
        tool_block["renderPlan"] = resolved_plan
    return ToolCallPayload.model_validate(tool_block).model_dump()


def _ensure_tool_call_completed_payload(
    payload: dict[str, Any], chat_id: str | None, node_type: str | None = None
) -> None:
    event_name = str(payload.get("event") or "")
    if event_name != "tool_call_completed":
        from ..streaming.runtime_events import EVENT_TOOL_CALL_COMPLETED
        if event_name != EVENT_TOOL_CALL_COMPLETED:
            return

    tool = payload.get("tool")
    if not isinstance(tool, dict):
        return

    tool_id = str(tool.get("id") or "")
    tool_name_value = tool.get("toolName")
    tool_name = (
        tool_name_value if isinstance(tool_name_value, str) else str(tool_name_value or "")
    )
    if not tool_id or not tool_name:
        return

    provider_data = tool.get("providerData")
    if not isinstance(provider_data, dict) or not provider_data:
        provider_data = None

    payload["tool"] = _build_tool_call_completed_payload(
        tool_id=tool_id,
        tool_name=tool_name,
        tool_args=tool.get("toolArgs") if isinstance(tool.get("toolArgs"), dict) else None,
        tool_result=tool.get("toolResult"),
        provider_data=provider_data,
        render_plan=tool.get("renderPlan") if isinstance(tool.get("renderPlan"), dict) else None,
        chat_id=chat_id,
        failed=bool(tool.get("failed")) or _did_tool_call_fail(tool_name, tool_id),
        node_type=node_type,
    )


def _generate_toolset_render_plan(
    *,
    tool_name: str | None,
    tool_args: dict[str, Any] | None,
    tool_result: Any,
    chat_id: str | None,
) -> dict[str, Any] | None:
    if not tool_name or not chat_id:
        return None
    try:
        executor = get_toolset_executor()
        tool_info = executor.get_tool_metadata(tool_name)
        if not tool_info:
            return None

        render_config = tool_info.get("render_config")
        if not isinstance(render_config, dict):
            return None

        config = render_config.get("config", {})
        toolset_dir = Path(executor.get_toolset_directory(tool_name))
        context = {
            "args": tool_args or {},
            "return": _parse_tool_result(tool_result),
            "chat_id": chat_id,
            "workspace": str(get_workspace_manager(chat_id).workspace_dir),
            "toolset": str(toolset_dir),
        }

        plan = get_render_plan_builder().build(
            renderer=str(render_config.get("renderer") or "default"),
            config=config if isinstance(config, dict) else {},
            context=context,
            toolset_dir=toolset_dir,
        )

        if (
            plan["renderer"] == "html"
            and "artifact" in plan["config"]
            and "content" not in plan["config"]
        ):
            logger.warning("Artifact not found: %s", plan["config"]["artifact"])

        return plan
    except Exception as exc:
        logger.warning("Failed to generate render plan for tool %s: %s", tool_name, exc)
        return None
