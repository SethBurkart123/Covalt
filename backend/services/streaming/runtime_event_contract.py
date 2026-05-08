from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class RuntimeEventContractError(ValueError):
    """Raised when runtime event contract data is invalid."""


_CONTRACT_PATH = Path(__file__).resolve().parents[3] / "contracts" / "runtime-events.v1.json"

_INLINE_CONTRACT: dict[str, Any] = {
    "version": "1.0.0",
    "events": [
        {"key": "RUN_STARTED", "name": "RunStarted"},
        {"key": "ASSISTANT_MESSAGE_ID", "name": "AssistantMessageId"},
        {"key": "RUN_CONTENT", "name": "RunContent"},
        {"key": "SEED_BLOCKS", "name": "SeedBlocks"},
        {"key": "REASONING_STARTED", "name": "ReasoningStarted"},
        {"key": "REASONING_STEP", "name": "ReasoningStep"},
        {"key": "REASONING_COMPLETED", "name": "ReasoningCompleted"},
        {"key": "TOOL_CALL_STARTED", "name": "ToolCallStarted"},
        {"key": "TOOL_CALL_COMPLETED", "name": "ToolCallCompleted"},
        {"key": "TOOL_CALL_FAILED", "name": "ToolCallFailed"},
        {"key": "TOOL_CALL_ERROR", "name": "ToolCallError"},
        {"key": "TOOL_CALL_PROGRESS", "name": "ToolCallProgress"},
        {"key": "WORKING_STATE_CHANGED", "name": "WorkingStateChanged"},
        {"key": "TOKEN_USAGE", "name": "TokenUsage"},
        {"key": "STREAM_WARNING", "name": "StreamWarning"},
        {"key": "APPROVAL_REQUIRED", "name": "ApprovalRequired"},
        {"key": "APPROVAL_RESOLVED", "name": "ApprovalResolved"},
        {"key": "MEMBER_RUN_STARTED", "name": "MemberRunStarted"},
        {"key": "MEMBER_RUN_COMPLETED", "name": "MemberRunCompleted"},
        {"key": "MEMBER_RUN_ERROR", "name": "MemberRunError"},
        {"key": "FLOW_NODE_STARTED", "name": "FlowNodeStarted"},
        {"key": "FLOW_NODE_COMPLETED", "name": "FlowNodeCompleted"},
        {"key": "FLOW_NODE_RESULT", "name": "FlowNodeResult"},
        {"key": "FLOW_NODE_ERROR", "name": "FlowNodeError"},
        {"key": "RUN_COMPLETED", "name": "RunCompleted"},
        {"key": "RUN_CANCELLED", "name": "RunCancelled"},
        {"key": "RUN_ERROR", "name": "RunError"},
        {"key": "STREAM_NOT_ACTIVE", "name": "StreamNotActive"},
        {"key": "STREAM_SUBSCRIBED", "name": "StreamSubscribed"},
    ],
    "groups": {
        "terminal": ["RUN_COMPLETED", "RUN_CANCELLED", "RUN_ERROR"],
        "tool": [
            "TOOL_CALL_STARTED",
            "TOOL_CALL_COMPLETED",
            "TOOL_CALL_FAILED",
            "TOOL_CALL_ERROR",
            "TOOL_CALL_PROGRESS",
            "APPROVAL_REQUIRED",
            "APPROVAL_RESOLVED",
        ],
        "member": ["MEMBER_RUN_STARTED", "MEMBER_RUN_COMPLETED", "MEMBER_RUN_ERROR"],
        "flowNode": ["FLOW_NODE_STARTED", "FLOW_NODE_COMPLETED", "FLOW_NODE_RESULT", "FLOW_NODE_ERROR"],
    },
}


def _load_runtime_event_contract() -> dict[str, Any]:
    if _CONTRACT_PATH.exists():
        raw = _CONTRACT_PATH.read_text(encoding="utf-8")
        data = json.loads(raw)
    else:
        data = _INLINE_CONTRACT

    if not isinstance(data, dict):
        raise RuntimeEventContractError("Runtime event contract must be a JSON object")

    version = data.get("version")
    if not isinstance(version, str) or not version.strip():
        raise RuntimeEventContractError("Runtime event contract requires a non-empty version")

    events = data.get("events")
    if not isinstance(events, list):
        raise RuntimeEventContractError("Runtime event contract requires an events array")

    keys_seen: set[str] = set()
    names_seen: set[str] = set()
    normalized_events: list[dict[str, str]] = []

    for entry in events:
        if not isinstance(entry, dict):
            raise RuntimeEventContractError("Runtime event entries must be objects")

        key = entry.get("key")
        name = entry.get("name")
        if not isinstance(key, str) or not key:
            raise RuntimeEventContractError("Runtime event entry key must be a non-empty string")
        if not isinstance(name, str) or not name:
            raise RuntimeEventContractError("Runtime event entry name must be a non-empty string")
        if key in keys_seen:
            raise RuntimeEventContractError(f"Duplicate runtime event key: {key}")
        if name in names_seen:
            raise RuntimeEventContractError(f"Duplicate runtime event name: {name}")

        keys_seen.add(key)
        names_seen.add(name)
        normalized_events.append({"key": key, "name": name})

    groups = data.get("groups") or {}
    if not isinstance(groups, dict):
        raise RuntimeEventContractError("Runtime event contract groups must be an object")

    normalized_groups: dict[str, tuple[str, ...]] = {}
    for group_name, group_keys in groups.items():
        if not isinstance(group_name, str) or not group_name:
            raise RuntimeEventContractError("Runtime event group names must be non-empty strings")
        if not isinstance(group_keys, list) or not all(
            isinstance(group_key, str) and group_key for group_key in group_keys
        ):
            raise RuntimeEventContractError(
                f"Runtime event group '{group_name}' must be an array of non-empty strings"
            )
        missing = [group_key for group_key in group_keys if group_key not in keys_seen]
        if missing:
            raise RuntimeEventContractError(
                f"Runtime event group '{group_name}' references unknown keys: {', '.join(sorted(missing))}"
            )
        normalized_groups[group_name] = tuple(group_keys)

    return {
        "version": version,
        "events": tuple(normalized_events),
        "groups": normalized_groups,
    }


_RUNTIME_EVENT_CONTRACT = _load_runtime_event_contract()

RUNTIME_EVENT_CONTRACT_VERSION: str = _RUNTIME_EVENT_CONTRACT["version"]
RUNTIME_EVENT_CONTRACT_EVENTS: tuple[dict[str, str], ...] = _RUNTIME_EVENT_CONTRACT["events"]
RUNTIME_EVENT_CONTRACT_GROUPS: dict[str, tuple[str, ...]] = _RUNTIME_EVENT_CONTRACT["groups"]

RUNTIME_EVENT_BY_KEY: dict[str, str] = {
    item["key"]: item["name"] for item in RUNTIME_EVENT_CONTRACT_EVENTS
}

KNOWN_RUNTIME_EVENTS: frozenset[str] = frozenset(RUNTIME_EVENT_BY_KEY.values())


def runtime_event_name(key: str) -> str:
    try:
        return RUNTIME_EVENT_BY_KEY[key]
    except KeyError as exc:
        raise RuntimeEventContractError(f"Unknown runtime event key: {key}") from exc
