import pytest

from backend.services.runtime_events import (
    EVENT_RUN_CONTENT,
    KNOWN_RUNTIME_EVENTS,
    RUNTIME_EVENT_CONTRACT_VERSION,
    emit_chat_event,
    make_chat_event,
)


class _FakeChannel:
    def __init__(self) -> None:
        self.sent = []

    def send_model(self, event) -> None:
        self.sent.append(event)


def test_make_chat_event_supports_known_event() -> None:
    event = make_chat_event(EVENT_RUN_CONTENT, content="hello")

    assert event.event == EVENT_RUN_CONTENT
    assert event.content == "hello"


def test_make_chat_event_allows_unknown_when_enabled() -> None:
    event = make_chat_event("CustomAgentEvent", allow_unknown=True, content="ok")

    assert event.event == "CustomAgentEvent"
    assert event.content == "ok"


def test_emit_chat_event_sends_on_channel() -> None:
    channel = _FakeChannel()

    emit_chat_event(channel, EVENT_RUN_CONTENT, content="token")

    assert len(channel.sent) == 1
    assert channel.sent[0].event == EVENT_RUN_CONTENT
    assert channel.sent[0].content == "token"


def test_make_chat_event_rejects_unknown_when_not_allowed() -> None:
    with pytest.raises(ValueError):
        make_chat_event("CustomAgentEvent", content="boom")


def test_emit_chat_event_rejects_unknown_when_not_allowed() -> None:
    channel = _FakeChannel()

    with pytest.raises(ValueError):
        emit_chat_event(channel, "CustomAgentEvent", content="boom")

    assert channel.sent == []


def test_known_runtime_events_contains_core_run_content() -> None:
    assert EVENT_RUN_CONTENT in KNOWN_RUNTIME_EVENTS


def test_runtime_event_contract_version_is_exposed() -> None:
    assert isinstance(RUNTIME_EVENT_CONTRACT_VERSION, str)
    assert RUNTIME_EVENT_CONTRACT_VERSION
