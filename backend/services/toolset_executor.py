from __future__ import annotations

import asyncio
import contextvars
import importlib.util
import json
import logging
import re
import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from agno.tools.function import Function

# Import agno_toolset for context management and decorator metadata
from agno_toolset import ToolContext, clear_context, get_tool_metadata, set_context

from .. import db
from ..db import db_session
from ..db.models import Tool, ToolCall, ToolOverride, Toolset
from .toolset_manager import get_toolset_directory
from .workspace_manager import WorkspaceManager, get_workspace_manager

logger = logging.getLogger(__name__)


class ToolsetExecutor:
    def __init__(self) -> None:
        self._loaded_tools: dict[str, tuple[Callable, str, dict[str, Any] | None]] = {}
        self._tool_metadata: dict[str, dict[str, Any]] = {}

    def _load_tool_module(
        self, toolset_id: str, entrypoint: str
    ) -> tuple[Callable, dict[str, Any] | None] | None:
        try:
            if ":" not in entrypoint:
                logger.error(f"Invalid entrypoint format: {entrypoint}")
                return None

            module_path, func_name = entrypoint.rsplit(":", 1)

            toolset_dir = get_toolset_directory(toolset_id)
            if not toolset_dir.exists():
                logger.error(f"Toolset directory not found: {toolset_dir}")
                return None

            rel_path = module_path.replace(".", "/") + ".py"
            module_file = toolset_dir / rel_path

            if not module_file.exists():
                logger.error(f"Module file not found: {module_file}")
                return None

            module_name = f"toolset_{toolset_id}_{module_path.replace('.', '_')}"

            spec = importlib.util.spec_from_file_location(module_name, module_file)
            if spec is None or spec.loader is None:
                logger.error(f"Failed to create module spec for {module_file}")
                return None

            module = importlib.util.module_from_spec(spec)
            sys.modules[module_name] = module
            spec.loader.exec_module(module)

            if not hasattr(module, func_name):
                logger.error(f"Function '{func_name}' not found in {module_file}")
                return None

            fn = getattr(module, func_name)

            tool_meta = get_tool_metadata(fn)
            decorator_data: dict[str, Any] | None = None
            if tool_meta:
                decorator_data = {
                    "name": tool_meta.name,
                    "description": tool_meta.description,
                    "schema": tool_meta.schema,
                    "requires_confirmation": tool_meta.requires_confirmation,
                    "category": tool_meta.category,
                }
            else:
                logger.warning(
                    f"Tool {entrypoint} has no @tool decorator. "
                    "Schema will not be inferred from type hints."
                )

            return (fn, decorator_data)

        except Exception as e:
            logger.error(f"Failed to load tool module {entrypoint}: {e}")
            return None

    def _get_tool_from_db(self, tool_id: str) -> dict[str, Any] | None:
        if tool_id in self._tool_metadata:
            return self._tool_metadata[tool_id]

        with db_session() as sess:
            tool = sess.query(Tool).filter(Tool.tool_id == tool_id).first()
            if tool is None:
                return None

            override = (
                sess.query(ToolOverride)
                .filter(ToolOverride.toolset_id == tool.toolset_id)
                .filter(ToolOverride.tool_id == tool_id)
                .first()
            )

            metadata = {
                "tool_id": tool.tool_id,
                "toolset_id": tool.toolset_id,
                "name": tool.name,
                "description": tool.description,
                "input_schema": json.loads(tool.input_schema)
                if tool.input_schema
                else None,
                "requires_confirmation": tool.requires_confirmation,
                "enabled": tool.enabled,
                "entrypoint": tool.entrypoint,
                "render_config": {
                    "renderer": override.renderer,
                    "config": json.loads(override.renderer_config)
                    if override.renderer_config
                    else {},
                }
                if override and override.renderer
                else None,
            }

            self._tool_metadata[tool_id] = metadata
            return metadata

    def get_tool_function(
        self, tool_id: str, chat_id: str, message_id: str | None = None
    ) -> Function | None:
        tool_info = self._get_tool_from_db(tool_id)
        if tool_info is None:
            return None

        toolset_id = tool_info.get("toolset_id")
        entrypoint = tool_info.get("entrypoint")

        if not toolset_id or not entrypoint:
            logger.warning(f"Tool {tool_id} has no toolset or entrypoint")
            return None

        cache_key = f"{toolset_id}:{entrypoint}"
        if cache_key not in self._loaded_tools:
            result = self._load_tool_module(toolset_id, entrypoint)
            if result is None:
                return None
            fn, decorator_data = result
            self._loaded_tools[cache_key] = (fn, toolset_id, decorator_data)

        tool_fn, _, decorator_data = self._loaded_tools[cache_key]

        async def toolset_tool_entrypoint(**kwargs: Any) -> str:
            return await self._execute_tool(
                tool_id=tool_id,
                toolset_id=toolset_id,
                tool_fn=tool_fn,
                chat_id=chat_id,
                message_id=message_id,
                args=kwargs,
            )

        if decorator_data:
            description = decorator_data.get("description") or tool_info.get(
                "description"
            )
            schema = decorator_data.get("schema") or {
                "type": "object",
                "properties": {},
            }
            requires_confirmation = decorator_data.get("requires_confirmation", False)
        else:
            description = tool_info.get("description")
            schema = tool_info.get("input_schema") or {
                "type": "object",
                "properties": {},
            }
            requires_confirmation = tool_info.get("requires_confirmation", False)

        toolset_tool_entrypoint.__name__ = tool_id
        toolset_tool_entrypoint.__doc__ = description or ""

        return Function(
            name=tool_id,
            description=description,
            parameters=schema,
            entrypoint=toolset_tool_entrypoint,
            skip_entrypoint_processing=True,
            requires_confirmation=requires_confirmation,
        )

    async def _execute_tool(
        self,
        tool_id: str,
        toolset_id: str,
        tool_fn: Callable,
        chat_id: str,
        args: dict[str, Any],
        message_id: str | None = None,
    ) -> str:
        workspace_manager = get_workspace_manager(chat_id)
        tool_call_id = str(uuid.uuid4())
        started_at = datetime.now().isoformat()

        pre_manifest_id: str | None = None
        actual_message_id = message_id
        with db_session() as sess:
            if not actual_message_id:
                chat = sess.query(db.Chat).filter(db.Chat.id == chat_id).first()
                if chat and chat.active_leaf_message_id:
                    actual_message_id = chat.active_leaf_message_id

            if actual_message_id:
                pre_manifest_id = db.get_manifest_for_message(sess, actual_message_id)
            else:
                pre_manifest_id = workspace_manager.get_active_manifest_id()

        self._record_tool_call(
            tool_call_id=tool_call_id,
            chat_id=chat_id,
            tool_id=tool_id,
            args=args,
            status="running",
            started_at=started_at,
            pre_manifest_id=pre_manifest_id,
            message_id=actual_message_id,
        )

        ctx = ToolContext(
            workspace=workspace_manager.workspace_dir,
            chat_id=chat_id,
            toolset_id=toolset_id,
        )
        set_context(ctx)

        try:
            if asyncio.iscoroutinefunction(tool_fn):
                result = await tool_fn(**args)
            else:
                ctx_copy = contextvars.copy_context()
                loop = asyncio.get_event_loop()
                result = await loop.run_in_executor(
                    None, lambda: ctx_copy.run(tool_fn, **args)
                )

            if not isinstance(result, dict):
                result = {"result": result}

            post_manifest_id = workspace_manager.snapshot(
                source="tool_run",
                source_ref=tool_call_id,
            )

            if actual_message_id and post_manifest_id:
                with db_session() as sess:
                    db.set_message_manifest(sess, actual_message_id, post_manifest_id)

            render_plan = self._generate_render_plan(tool_id, args, result, chat_id)

            self._update_tool_call(
                tool_call_id=tool_call_id,
                status="success",
                result=result,
                render_plan=render_plan,
                post_manifest_id=post_manifest_id,
            )

            if pre_manifest_id or post_manifest_id:
                changed_paths, deleted_paths = workspace_manager.diff_manifests(
                    pre_manifest_id, post_manifest_id
                )
                if changed_paths or deleted_paths:
                    try:
                        from ..commands.events import broadcast_workspace_files_changed

                        asyncio.create_task(
                            broadcast_workspace_files_changed(
                                chat_id, changed_paths, deleted_paths
                            )
                        )
                    except Exception as e:
                        logger.debug(f"Failed to broadcast workspace changes: {e}")

            return json.dumps(result, indent=2)

        except Exception as e:
            logger.error(f"Tool execution failed for {tool_id}: {e}")
            try:
                post_manifest_id = workspace_manager.snapshot(
                    source="tool_run",
                    source_ref=tool_call_id,
                )
            except Exception:
                post_manifest_id = None

            self._update_tool_call(
                tool_call_id=tool_call_id,
                status="error",
                error=str(e),
                post_manifest_id=post_manifest_id,
            )

            return f"Error executing tool: {e}"

        finally:
            clear_context()

    def _record_tool_call(
        self,
        tool_call_id: str,
        chat_id: str,
        tool_id: str,
        args: dict[str, Any],
        status: str,
        started_at: str,
        pre_manifest_id: str | None = None,
        message_id: str | None = None,
    ) -> None:
        with db_session() as session:
            tool_call = ToolCall(
                id=tool_call_id,
                chat_id=chat_id,
                message_id=message_id or "",
                tool_id=tool_id,
                args=json.dumps(args),
                status=status,
                started_at=started_at,
                pre_manifest_id=pre_manifest_id,
            )
            session.add(tool_call)
            session.commit()

    def _update_tool_call(
        self,
        tool_call_id: str,
        status: str,
        result: dict[str, Any] | None = None,
        render_plan: dict[str, Any] | None = None,
        error: str | None = None,
        post_manifest_id: str | None = None,
    ) -> None:
        with db_session() as session:
            tool_call = (
                session.query(ToolCall).filter(ToolCall.id == tool_call_id).first()
            )
            if tool_call:
                tool_call.status = status
                tool_call.finished_at = datetime.now().isoformat()
                if result is not None:
                    tool_call.result = json.dumps(result)
                if render_plan is not None:
                    tool_call.render_plan = json.dumps(render_plan)
                if error is not None:
                    tool_call.error = error
                if post_manifest_id is not None:
                    tool_call.post_manifest_id = post_manifest_id
                session.commit()

    def generate_render_plan(
        self,
        tool_id: str,
        args: dict[str, Any],
        result: dict[str, Any],
        chat_id: str,
    ) -> dict[str, Any] | None:
        return self._generate_render_plan(tool_id, args, result, chat_id)

    def _generate_render_plan(
        self,
        tool_id: str,
        args: dict[str, Any],
        result: dict[str, Any],
        chat_id: str,
    ) -> dict[str, Any] | None:
        tool_info = self._get_tool_from_db(tool_id)
        if not tool_info or not tool_info.get("render_config"):
            return None

        render_config = tool_info["render_config"]
        config = render_config.get("config", {})

        context = {
            "args": args,
            "return": result,
            "chat_id": chat_id,
            "workspace": str(get_workspace_manager(chat_id).workspace_dir),
            "toolset": str(get_toolset_directory(tool_info.get("toolset_id", ""))),
        }

        interpolated_config = self._interpolate(config, context)

        renderer_type = render_config["renderer"]
        if renderer_type == "html" and "artifact" in interpolated_config:
            artifact_path = interpolated_config["artifact"]
            html_content = self._load_artifact_content(
                tool_info.get("toolset_id", ""), artifact_path
            )
            if html_content:
                interpolated_config["content"] = html_content

        return {
            "renderer": renderer_type,
            "config": interpolated_config,
        }

    def _interpolate(self, obj: Any, context: dict[str, Any]) -> Any:
        if isinstance(obj, str):
            return self._interpolate_string(obj, context)
        elif isinstance(obj, dict):
            return {k: self._interpolate(v, context) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [self._interpolate(item, context) for item in obj]
        return obj

    def _interpolate_string(self, s: str, context: dict[str, Any]) -> Any:
        if s.startswith("$") and "." not in s[1:] and s[1:] in context:
            return context[s[1:]]

        if s.startswith("$"):
            parts = s[1:].split(".", 1)
            var_name = parts[0]

            if var_name in context:
                value = context[var_name]
                if len(parts) > 1 and isinstance(value, dict):
                    path_parts = parts[1].split(".")
                    for part in path_parts:
                        if isinstance(value, dict) and part in value:
                            value = value[part]
                        else:
                            return s
                return value

        def replace_var(match: re.Match) -> str:
            var_expr = match.group(1)
            parts = var_expr.split(".", 1)
            var_name = parts[0]

            if var_name in context:
                value = context[var_name]
                if len(parts) > 1 and isinstance(value, dict):
                    path_parts = parts[1].split(".")
                    for part in path_parts:
                        if isinstance(value, dict) and part in value:
                            value = value[part]
                        else:
                            return match.group(0)
                return str(value)
            return match.group(0)

        return re.sub(r"\$(\w+(?:\.\w+)*)", replace_var, s)

    def _load_artifact_content(self, toolset_id: str, artifact_path: str) -> str | None:
        if not toolset_id:
            return None

        try:
            toolset_dir = get_toolset_directory(toolset_id)
            if artifact_path.startswith(str(toolset_dir)):
                full_path = Path(artifact_path)
            else:
                full_path = toolset_dir / artifact_path

            if full_path.exists() and full_path.is_file():
                return full_path.read_text(encoding="utf-8")

            logger.warning(f"Artifact not found: {full_path}")
            return None
        except Exception as e:
            logger.error(f"Failed to load artifact {artifact_path}: {e}")
            return None

    def list_toolset_tools(self) -> list[dict[str, Any]]:
        with db_session() as session:
            tools = (
                session.query(Tool)
                .join(Toolset)
                .filter(Tool.enabled.is_(True), Toolset.enabled.is_(True))
                .all()
            )

            return [
                {
                    "id": t.tool_id,
                    "name": t.name,
                    "description": t.description,
                    "requires_confirmation": t.requires_confirmation,
                    "toolset_id": t.toolset_id,
                    "toolset_name": t.toolset.name if t.toolset else t.toolset_id,
                }
                for t in tools
            ]

    def clear_cache(self) -> None:
        self._loaded_tools.clear()
        self._tool_metadata.clear()


_toolset_executor: ToolsetExecutor | None = None


def get_toolset_executor() -> ToolsetExecutor:
    global _toolset_executor
    if _toolset_executor is None:
        _toolset_executor = ToolsetExecutor()
    return _toolset_executor
