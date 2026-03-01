import json
import re
from pathlib import Path

from backend.services.runtime_events import (
    KNOWN_RUNTIME_EVENTS,
    RUNTIME_EVENT_CONTRACT_VERSION,
)

_RUNTIME_EVENT_OBJECT_PATTERN = re.compile(
    r"export\s+const\s+RUNTIME_EVENT\s*=\s*\{(?P<body>.*?)\}\s*as\s+const;",
    re.DOTALL,
)
_RUNTIME_EVENT_ENTRY_PATTERN = re.compile(
    r"(?P<key>[A-Z0-9_]+)\s*:\s*\"(?P<name>[^\"]+)\"",
)


def _load_runtime_event_contract() -> dict:
    contract_path = (
        Path(__file__).resolve().parents[1]
        / "contracts"
        / "runtime-events.v1.json"
    )
    return json.loads(contract_path.read_text(encoding="utf-8"))


def _parse_frontend_runtime_event_map() -> dict[str, str]:
    frontend_runtime_events_path = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "lib"
        / "services"
        / "runtime-events.ts"
    )
    runtime_events_source = frontend_runtime_events_path.read_text(encoding="utf-8")

    object_match = _RUNTIME_EVENT_OBJECT_PATTERN.search(runtime_events_source)
    assert object_match is not None, "Failed to locate RUNTIME_EVENT object in runtime-events.ts"

    frontend_map = {
        match.group("key"): match.group("name")
        for match in _RUNTIME_EVENT_ENTRY_PATTERN.finditer(object_match.group("body"))
    }
    assert frontend_map, "Failed to parse runtime event entries from runtime-events.ts"
    return frontend_map


def test_backend_runtime_event_contract_version_matches_contract_file() -> None:
    contract = _load_runtime_event_contract()
    assert RUNTIME_EVENT_CONTRACT_VERSION == contract["version"]


def test_backend_known_runtime_events_match_canonical_contract() -> None:
    contract = _load_runtime_event_contract()
    contract_events = [event["name"] for event in contract["events"]]

    assert sorted(KNOWN_RUNTIME_EVENTS) == sorted(contract_events)


def test_backend_and_frontend_runtime_event_contract_are_identical() -> None:
    contract = _load_runtime_event_contract()
    contract_map = {event["key"]: event["name"] for event in contract["events"]}
    frontend_map = _parse_frontend_runtime_event_map()

    assert frontend_map == contract_map
    assert sorted(frontend_map.values()) == sorted(KNOWN_RUNTIME_EVENTS)
