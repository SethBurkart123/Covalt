from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class NodeDefinitionRecord:
    node_type: str
    definition_module: str
    definition_path: str
    node_id: str | None
    name: str | None
    category: str | None
    execution_mode: str | None


def build_node_definition_records() -> list[NodeDefinitionRecord]:
    root = Path(__file__).resolve().parents[2] / "nodes"
    records: list[NodeDefinitionRecord] = []

    for definition_path in sorted(root.rglob("definition.ts")):
        node_type = definition_path.parent.name.replace("_", "-")
        module_path = str(definition_path.relative_to(root.parent)).replace("\\", "/")
        definition_text = definition_path.read_text(encoding="utf-8")

        records.append(
            NodeDefinitionRecord(
                node_type=node_type,
                definition_module=module_path,
                definition_path=str(definition_path),
                node_id=_extract_string_literal(definition_text, "id"),
                name=_extract_string_literal(definition_text, "name"),
                category=_extract_string_literal(definition_text, "category"),
                execution_mode=_extract_string_literal(definition_text, "executionMode"),
            )
        )

    return records


def list_node_plugins() -> list[dict[str, Any]]:
    from nodes import list_node_plugin_metadata

    runtime_entries = {entry["node_type"]: entry for entry in list_node_plugin_metadata()}
    definition_entries = {
        entry.node_type: entry
        for entry in build_node_definition_records()
    }

    node_types = sorted(set(runtime_entries) | set(definition_entries))
    plugins: list[dict[str, Any]] = []

    for node_type in node_types:
        runtime = runtime_entries.get(node_type, {})
        definition = definition_entries.get(node_type)
        plugins.append(
            {
                "node_type": node_type,
                "runtime": {
                    "module_path": runtime.get("module_path"),
                    "has_execute": runtime.get("has_execute", False),
                    "has_materialize": runtime.get("has_materialize", False),
                    "has_configure_runtime": runtime.get("has_configure_runtime", False),
                    "has_init_routes": runtime.get("has_init_routes", False),
                },
                "definition": {
                    "module_path": definition.definition_module if definition else None,
                    "definition_path": definition.definition_path if definition else None,
                    "node_id": definition.node_id if definition else None,
                    "name": definition.name if definition else None,
                    "category": definition.category if definition else None,
                    "execution_mode": definition.execution_mode if definition else None,
                },
                "coherent": bool(
                    definition
                    and definition.node_id == node_type
                    and runtime.get("module_path")
                ),
            }
        )

    return plugins


def _extract_string_literal(source: str, field: str) -> str | None:
    marker = f"{field}:"
    start = source.find(marker)
    if start == -1:
        return None

    start += len(marker)
    while start < len(source) and source[start] in {" ", "\t"}:
        start += 1

    if start >= len(source) or source[start] not in {"'", '"'}:
        return None

    quote = source[start]
    end = source.find(quote, start + 1)
    if end == -1:
        return None

    return source[start + 1 : end]
