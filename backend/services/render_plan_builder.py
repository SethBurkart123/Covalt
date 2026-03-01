from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from ..models import normalize_renderer_alias


class RenderPlanBuilder:
    def build(
        self,
        *,
        renderer: str,
        config: dict[str, Any],
        context: dict[str, Any],
        toolset_dir: Path,
    ) -> dict[str, Any]:
        interpolated_config = self._interpolate(config, context)
        renderer_type = normalize_renderer_alias(renderer) or renderer

        if renderer_type == "html" and "artifact" in interpolated_config:
            artifact_path = interpolated_config["artifact"]
            html_content = self._load_artifact_content(toolset_dir, artifact_path)
            if html_content is not None:
                interpolated_config["content"] = html_content

        return {
            "renderer": renderer_type,
            "config": interpolated_config,
        }

    def _interpolate(self, obj: Any, context: dict[str, Any]) -> Any:
        if isinstance(obj, str):
            return self._interpolate_string(obj, context)
        if isinstance(obj, dict):
            return {k: self._interpolate(v, context) for k, v in obj.items()}
        if isinstance(obj, list):
            return [self._interpolate(item, context) for item in obj]
        return obj

    def _interpolate_string(self, value: str, context: dict[str, Any]) -> Any:
        if value.startswith("$") and "." not in value[1:] and value[1:] in context:
            return context[value[1:]]

        if value.startswith("$"):
            parts = value[1:].split(".", 1)
            root = parts[0]
            if root in context:
                resolved = context[root]
                if len(parts) > 1 and isinstance(resolved, dict):
                    for key in parts[1].split("."):
                        if isinstance(resolved, dict) and key in resolved:
                            resolved = resolved[key]
                        else:
                            return value
                return resolved

        def replace_var(match: re.Match[str]) -> str:
            parts = match.group(1).split(".", 1)
            root = parts[0]
            if root not in context:
                return match.group(0)

            resolved = context[root]
            if len(parts) > 1 and isinstance(resolved, dict):
                for key in parts[1].split("."):
                    if isinstance(resolved, dict) and key in resolved:
                        resolved = resolved[key]
                    else:
                        return match.group(0)
            return str(resolved)

        return re.sub(r"\$(\w+(?:\.\w+)*)", replace_var, value)

    def _load_artifact_content(self, toolset_dir: Path, artifact_path: str) -> str | None:
        full_path = (
            Path(artifact_path)
            if artifact_path.startswith(str(toolset_dir))
            else toolset_dir / artifact_path
        )

        if full_path.exists() and full_path.is_file():
            return full_path.read_text(encoding="utf-8")
        return None


_render_plan_builder: RenderPlanBuilder | None = None


def get_render_plan_builder() -> RenderPlanBuilder:
    global _render_plan_builder
    if _render_plan_builder is None:
        _render_plan_builder = RenderPlanBuilder()
    return _render_plan_builder
