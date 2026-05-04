import re
from pathlib import Path

from backend.services.streaming.runtime_event_contract import RUNTIME_EVENT_BY_KEY
from backend.services.streaming.runtime_events import (
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
_CONTRACT_VERSION_PATTERN = re.compile(
    r"export\s+const\s+RUNTIME_EVENT_CONTRACT_VERSION\s*=\s*\"(?P<version>[^\"]+)\"\s+as\s+const;",
)


def _frontend_runtime_events_source() -> str:
    frontend_runtime_events_path = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "lib"
        / "services"
        / "runtime-events.ts"
    )
    return frontend_runtime_events_path.read_text(encoding="utf-8")


def _parse_frontend_runtime_event_map() -> dict[str, str]:
    runtime_events_source = _frontend_runtime_events_source()

    object_match = _RUNTIME_EVENT_OBJECT_PATTERN.search(runtime_events_source)
    assert object_match is not None, "Failed to locate RUNTIME_EVENT object in runtime-events.ts"

    frontend_map = {
        match.group("key"): match.group("name")
        for match in _RUNTIME_EVENT_ENTRY_PATTERN.finditer(object_match.group("body"))
    }
    assert frontend_map, "Failed to parse runtime event entries from runtime-events.ts"
    return frontend_map


def _parse_frontend_runtime_event_contract_version() -> str:
    version_match = _CONTRACT_VERSION_PATTERN.search(_frontend_runtime_events_source())
    assert version_match is not None, "Failed to locate RUNTIME_EVENT_CONTRACT_VERSION in runtime-events.ts"
    return version_match.group("version")


def test_backend_and_frontend_runtime_event_versions_match() -> None:
    assert RUNTIME_EVENT_CONTRACT_VERSION == _parse_frontend_runtime_event_contract_version()


def test_backend_and_frontend_runtime_event_contract_are_identical() -> None:
    frontend_map = _parse_frontend_runtime_event_map()

    assert frontend_map == RUNTIME_EVENT_BY_KEY
    assert sorted(frontend_map.values()) == sorted(KNOWN_RUNTIME_EVENTS)
