from __future__ import annotations

import pytest

from backend.services import model_schema_cache


def test_cache_model_metadata_round_trips_copy() -> None:
    model_schema_cache._model_metadata_cache.clear()

    model_schema_cache.cache_model_metadata(
        "openai",
        "gpt-4o",
        {"supports_reasoning": True},
    )

    cached = model_schema_cache.get_cached_model_metadata("openai", "gpt-4o")
    assert cached == {"supports_reasoning": True}

    assert cached is not None
    cached["supports_reasoning"] = False

    cached_again = model_schema_cache.get_cached_model_metadata("openai", "gpt-4o")
    assert cached_again == {"supports_reasoning": True}


def test_get_effective_option_schema_uses_provider_hook(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    model_schema_cache._model_metadata_cache.clear()
    model_schema_cache.cache_model_metadata(
        "anthropic",
        "claude-test",
        {"supports_thinking": True},
    )

    def fake_options(provider: str, model_id: str, model_metadata: dict | None):
        assert provider == "anthropic"
        assert model_id == "claude-test"
        assert model_metadata == {"supports_thinking": True}
        return {
            "main": [
                {
                    "key": "thinking",
                    "label": "Thinking",
                    "type": "select",
                    "default": "auto",
                    "options": [
                        {"value": "auto", "label": "Auto"},
                        {"value": "high", "label": "High"},
                    ],
                }
            ],
            "advanced": [],
        }

    monkeypatch.setattr(model_schema_cache, "get_provider_model_options", fake_options)

    schema = model_schema_cache.get_effective_option_schema("anthropic", "claude-test")
    assert len(schema.main) == 1
    assert schema.main[0].key == "thinking"


def test_get_effective_option_schema_falls_back_to_empty_on_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    model_schema_cache._model_metadata_cache.clear()

    def boom(provider: str, model_id: str, model_metadata: dict | None):
        raise RuntimeError(f"boom for {provider}:{model_id} ({model_metadata})")

    monkeypatch.setattr(model_schema_cache, "get_provider_model_options", boom)

    schema = model_schema_cache.get_effective_option_schema("openai", "gpt-4o")
    assert schema.main == []
    assert schema.advanced == []
