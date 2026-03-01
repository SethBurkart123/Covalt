from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class RuntimeEventContractError(ValueError):
    """Raised when runtime event contract data is invalid."""


_CONTRACT_PATH = Path(__file__).resolve().parents[2] / "contracts" / "runtime-events.v1.json"


def _load_runtime_event_contract() -> dict[str, Any]:
    raw = _CONTRACT_PATH.read_text(encoding="utf-8")
    data = json.loads(raw)

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


def runtime_event_group(group: str) -> tuple[str, ...]:
    if group not in RUNTIME_EVENT_CONTRACT_GROUPS:
        return tuple()
    keys = RUNTIME_EVENT_CONTRACT_GROUPS[group]
    return tuple(runtime_event_name(key) for key in keys)
