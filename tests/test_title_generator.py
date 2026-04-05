from __future__ import annotations

from contextlib import contextmanager
from types import SimpleNamespace

from backend.services.streaming import title_generator


@contextmanager
def _fake_db_session():
    yield SimpleNamespace()


def _mock_title_db(monkeypatch, *, provider: str, model_id: str) -> None:
    monkeypatch.setattr(title_generator.db, "db_session", lambda: _fake_db_session())
    monkeypatch.setattr(
        title_generator.db,
        "get_auto_title_settings",
        lambda _sess: {
            "enabled": True,
            "prompt": title_generator.DEFAULT_PROMPT,
            "model_mode": "current",
            "provider": "openai",
            "model_id": "gpt-4o-mini",
        },
    )
    monkeypatch.setattr(
        title_generator.db,
        "get_chat_messages",
        lambda _sess, _chat_id: [
            {
                "role": "user",
                "content": "Render an artifact-style tool card",
            }
        ],
    )
    monkeypatch.setattr(
        title_generator.db,
        "get_chat_agent_config",
        lambda _sess, _chat_id: {
            "provider": provider,
            "model_id": model_id,
        },
    )
    monkeypatch.setattr(
        title_generator.db,
        "get_default_agent_config",
        lambda: {
            "provider": provider,
            "model_id": model_id,
        },
    )


def test_generate_title_skips_e2e_provider_when_e2e_mode_enabled(monkeypatch) -> None:
    monkeypatch.setenv("COVALT_E2E_TESTS", "1")
    _mock_title_db(monkeypatch, provider="e2e", model_id="approval")

    candidates: list[tuple[str, str]] = []

    def _capture_candidates(provider: str, model_id: str, _instructions: str, _message: str) -> str | None:
        candidates.append((provider, model_id))
        return None

    monkeypatch.setattr(title_generator, "_run_title_request", _capture_candidates)

    title = title_generator.generate_title_for_chat("chat-1")

    assert title == "Render an artifact-style tool card"
    assert candidates
    assert all(provider != "e2e" for provider, _ in candidates)


def test_generate_title_uses_e2e_provider_when_not_in_e2e_mode(monkeypatch) -> None:
    monkeypatch.delenv("COVALT_E2E_TESTS", raising=False)
    _mock_title_db(monkeypatch, provider="e2e", model_id="approval")

    candidates: list[tuple[str, str]] = []

    def _capture_candidates(provider: str, model_id: str, _instructions: str, _message: str) -> str | None:
        candidates.append((provider, model_id))
        if provider == "e2e":
            return "E2E Generated Title"
        return None

    monkeypatch.setattr(title_generator, "_run_title_request", _capture_candidates)

    title = title_generator.generate_title_for_chat("chat-2")

    assert title == "E2E Generated Title"
    assert candidates[0] == ("e2e", "approval")
