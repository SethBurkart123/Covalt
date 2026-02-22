from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from backend.models.chat import OptionSchema
from backend.services.option_validation import (
    MAX_OPTION_KEYS,
    MAX_PAYLOAD_SIZE,
    ModelResolutionError,
    merge_model_params,
    resolve_and_validate_model_options,
    resolve_model_for_chat,
    sanitize_final_kwargs,
    validate_model_options,
)
from backend.services import option_validation as option_validation_service


def _mock_db(
    *,
    config: dict | None = None,
    chat_model: str | None = None,
) -> MagicMock:
    db_mock = MagicMock()
    session = MagicMock()
    session.get.return_value = (
        SimpleNamespace(model=chat_model) if chat_model is not None else None
    )

    db_mock.Chat = object()
    db_mock.db_session.return_value.__enter__.return_value = session
    db_mock.db_session.return_value.__exit__.return_value = False
    db_mock.get_chat_agent_config.return_value = config
    return db_mock


def _sample_schema() -> OptionSchema:
    return OptionSchema.model_validate(
        {
            "main": [
                {
                    "key": "thinking",
                    "label": "Thinking",
                    "type": "select",
                    "default": "auto",
                    "options": [
                        {"value": "none", "label": "Off"},
                        {"value": "auto", "label": "Auto"},
                        {"value": "high", "label": "High"},
                    ],
                }
            ],
            "advanced": [
                {
                    "key": "temperature",
                    "label": "Temperature",
                    "type": "slider",
                    "min": 0,
                    "max": 1,
                    "step": 0.1,
                    "default": 0.7,
                },
                {
                    "key": "enabled",
                    "label": "Enabled",
                    "type": "boolean",
                    "default": True,
                },
            ],
        }
    )


def test_resolve_model_for_chat_prefers_request_model() -> None:
    provider, model_id = resolve_model_for_chat(
        chat_id="chat-1",
        request_model_id="openai:gpt-4o",
    )
    assert (provider, model_id) == ("openai", "gpt-4o")


@pytest.mark.parametrize(
    "model_id",
    ["", "gpt-4o", ":gpt-4o", "openai:"],
)
def test_resolve_model_for_chat_rejects_bad_format(model_id: str) -> None:
    with pytest.raises(ModelResolutionError):
        resolve_model_for_chat(chat_id="chat-1", request_model_id=model_id)


def test_resolve_model_for_chat_uses_chat_config(monkeypatch: pytest.MonkeyPatch) -> None:
    db_mock = _mock_db(config={"provider": "anthropic", "model_id": "claude-sonnet"})
    monkeypatch.setattr(option_validation_service, "db", db_mock)

    provider, model_id = resolve_model_for_chat(chat_id="chat-1", request_model_id=None)
    assert (provider, model_id) == ("anthropic", "claude-sonnet")


def test_resolve_model_for_chat_uses_agent_config(monkeypatch: pytest.MonkeyPatch) -> None:
    db_mock = _mock_db(config={"agent_id": "agent-abc"})
    monkeypatch.setattr(option_validation_service, "db", db_mock)

    provider, model_id = resolve_model_for_chat(chat_id="chat-1", request_model_id=None)
    assert (provider, model_id) == ("agent", "agent-abc")


def test_resolve_model_for_chat_uses_chat_model_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db_mock = _mock_db(config=None, chat_model="google:gemini-2.5-pro")
    monkeypatch.setattr(option_validation_service, "db", db_mock)

    provider, model_id = resolve_model_for_chat(chat_id="chat-1", request_model_id=None)
    assert (provider, model_id) == ("google", "gemini-2.5-pro")


def test_resolve_model_for_chat_errors_without_any_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db_mock = _mock_db(config=None, chat_model=None)
    monkeypatch.setattr(option_validation_service, "db", db_mock)

    with pytest.raises(ModelResolutionError):
        resolve_model_for_chat(chat_id="chat-1", request_model_id=None)


def test_resolve_and_validate_model_options_calls_dependencies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    schema = _sample_schema()
    calls: dict[str, object] = {}

    def fake_resolve(chat_id: str | None, request_model_id: str | None):
        calls["resolve"] = (chat_id, request_model_id)
        return "openai", "gpt-4o"

    def fake_schema(provider: str, model_id: str):
        calls["schema"] = (provider, model_id)
        return schema

    def fake_validate(options: object, incoming_schema: OptionSchema):
        calls["validate"] = (options, incoming_schema)
        return {"temperature": 0.7}

    monkeypatch.setattr(option_validation_service, "resolve_model_for_chat", fake_resolve)
    monkeypatch.setattr(option_validation_service, "get_effective_option_schema", fake_schema)
    monkeypatch.setattr(option_validation_service, "validate_model_options", fake_validate)

    result = resolve_and_validate_model_options(
        chat_id="chat-1",
        request_model_id="openai:gpt-4o",
        request_options={"temperature": 0.7},
    )

    assert result == {"temperature": 0.7}
    assert calls["resolve"] == ("chat-1", "openai:gpt-4o")
    assert calls["schema"] == ("openai", "gpt-4o")
    assert calls["validate"] == ({"temperature": 0.7}, schema)


def test_resolve_and_validate_model_options_propagates_resolution_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def boom(*_args: object, **_kwargs: object):
        raise ModelResolutionError("bad model")

    monkeypatch.setattr(option_validation_service, "resolve_model_for_chat", boom)

    with pytest.raises(ModelResolutionError, match="bad model"):
        resolve_and_validate_model_options(
            chat_id="chat-1",
            request_model_id=None,
            request_options={},
        )


def test_validate_model_options_fills_defaults() -> None:
    schema = _sample_schema()

    validated = validate_model_options({"thinking": "high"}, schema)

    assert validated == {
        "thinking": "high",
        "temperature": 0.7,
        "enabled": True,
    }


def test_validate_model_options_rejects_unknown_key() -> None:
    schema = _sample_schema()

    with pytest.raises(ValueError, match="Unknown option key"):
        validate_model_options({"oops": True}, schema)


def test_validate_model_options_rejects_type_and_range() -> None:
    schema = _sample_schema()

    with pytest.raises(ValueError, match="must be numeric"):
        validate_model_options({"temperature": "hot"}, schema)

    with pytest.raises(ValueError, match="below minimum"):
        validate_model_options({"temperature": -1}, schema)

    with pytest.raises(ValueError, match="must be boolean"):
        validate_model_options({"enabled": 1}, schema)

    with pytest.raises(ValueError, match="must be finite"):
        validate_model_options({"temperature": float("nan")}, schema)

    with pytest.raises(ValueError, match="must be finite"):
        validate_model_options({"temperature": float("inf")}, schema)


def test_validate_model_options_enforces_bounds() -> None:
    schema = OptionSchema(main=[], advanced=[])

    too_many = {f"k{i}": i for i in range(MAX_OPTION_KEYS + 1)}
    with pytest.raises(ValueError, match="Too many option keys"):
        validate_model_options(too_many, schema)

    large_value = "x" * (MAX_PAYLOAD_SIZE + 128)
    with pytest.raises(ValueError, match="payload too large"):
        validate_model_options({"k": large_value}, schema)


def test_merge_model_params_only_accepts_allowlist() -> None:
    merged = merge_model_params(
        {
            "temperature": 0.5,
            "max_tokens": 512,
            "api_key": "nope",
            "extra": "ignored",
        },
        {"temperature": 0.9, "thinking_budget": 8000},
    )

    assert merged == {
        "temperature": 0.5,
        "max_tokens": 512,
        "thinking_budget": 8000,
    }


def test_sanitize_final_kwargs_rejects_reserved_and_internal_keys() -> None:
    assert sanitize_final_kwargs({"temperature": 0.7}) == {"temperature": 0.7}

    with pytest.raises(ValueError, match="Reserved parameter"):
        sanitize_final_kwargs({"api_key": "secret"})

    with pytest.raises(ValueError, match="Reserved parameter"):
        sanitize_final_kwargs({"_internal": True})
