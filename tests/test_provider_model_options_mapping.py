from __future__ import annotations

import backend.providers.anthropic as anthropic_provider
import backend.providers.google as google_provider


def test_anthropic_map_model_options_maps_thinking_budget_to_request_params() -> None:
    mapped = anthropic_provider.map_model_options(
        "claude-3-7-sonnet",
        {
            "thinking": "high",
            "thinking_budget": 8192,
            "temperature": 0.6,
            "max_tokens": 4096,
        },
    )

    assert mapped["temperature"] == 0.6
    assert mapped["max_tokens"] == 4096
    assert mapped["request_params"] == {
        "thinking": {"type": "enabled", "budget_tokens": 8192}
    }


def test_anthropic_map_model_options_omits_thinking_for_auto_and_none() -> None:
    for thinking in ("auto", "none"):
        mapped = anthropic_provider.map_model_options(
            "claude-3-7-sonnet",
            {
                "thinking": thinking,
                "thinking_budget": 8192,
            },
        )
        assert "request_params" not in mapped


def test_google_map_model_options_maps_thinking_budget_to_request_params() -> None:
    mapped = google_provider.map_model_options(
        "gemini-2.5-pro",
        {
            "temperature": 0.3,
            "max_tokens": 2048,
            "thinking_budget": 4096,
        },
    )

    assert mapped["temperature"] == 0.3
    assert mapped["max_tokens"] == 2048
    assert mapped["request_params"] == {
        "thinking": {"type": "enabled", "budget_tokens": 4096}
    }


def test_google_map_model_options_clamps_vertex_thinking_budget(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        google_provider,
        "get_extra_config",
        lambda: {"vertexai": True},
    )
    mapped = google_provider.map_model_options(
        "gemini-2.5-flash",
        {"thinking_budget": 32768},
    )

    assert mapped["request_params"] == {
        "thinking": {"type": "enabled", "budget_tokens": 24576}
    }


def test_google_get_model_options_uses_vertex_thinking_budget_max(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        google_provider,
        "get_extra_config",
        lambda: {"vertexai": True},
    )

    schema = google_provider.get_model_options(
        "gemini-2.5-flash",
        model_metadata={"supports_reasoning": True},
    )

    assert schema["main"][0]["max"] == 24576


def test_google_get_model_merges_vertex_and_existing_request_params(
    monkeypatch,
) -> None:
    monkeypatch.setattr(google_provider, "get_api_key", lambda: "test-key")
    monkeypatch.setattr(
        google_provider,
        "get_extra_config",
        lambda: {
            "vertexai": True,
            "project_id": "proj-123",
            "location": "us-central1",
        },
    )

    model = google_provider.get_google_model(
        "gemini-2.5-pro",
        request_params={"thinking": {"type": "enabled", "budget_tokens": 2048}},
    )

    assert model.request_params == {
        "thinking": {"type": "enabled", "budget_tokens": 2048},
        "vertex_project": "proj-123",
        "vertex_location": "us-central1",
    }


def test_google_get_model_ignores_vertex_when_extra_is_string_false(
    monkeypatch,
) -> None:
    monkeypatch.setattr(google_provider, "get_api_key", lambda: "test-key")
    monkeypatch.setattr(
        google_provider,
        "get_extra_config",
        lambda: {
            "vertexai": "false",
            "project_id": "proj-123",
            "location": "us-central1",
        },
    )

    model = google_provider.get_google_model(
        "gemini-2.5-flash",
        request_params={"thinking": {"type": "enabled", "budget_tokens": 2048}},
    )

    assert model.request_params == {
        "thinking": {"type": "enabled", "budget_tokens": 2048},
    }
