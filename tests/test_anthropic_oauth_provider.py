from __future__ import annotations

import asyncio

import httpx

import backend.providers.anthropic_oauth as anthropic_oauth_provider


def test_get_model_options_uses_reasoning_levels_from_metadata() -> None:
    schema = anthropic_oauth_provider.get_model_options(
        "claude-opus-4-6",
        {
            "supported_reasoning_levels": [
                {"effort": "low"},
                {"effort": "max"},
            ],
            "default_reasoning_level": "max",
        },
    )

    assert schema["main"] == [
        {
            "key": "reasoning_effort",
            "label": "Reasoning Effort",
            "type": "select",
            "default": "max",
            "options": [
                {"value": "auto", "label": "auto"},
                {"value": "low", "label": "low"},
                {"value": "max", "label": "max"},
            ],
        }
    ]
    assert schema["advanced"] == []


def test_resolve_options_maps_reasoning_effort_for_adaptive_models() -> None:
    mapped = anthropic_oauth_provider.resolve_options(
        "claude-opus-4-6",
        {"reasoning_effort": "max"},
        None,
    )

    assert mapped == {
        "request_params": {
            "thinking": {"type": "adaptive"},
            "output_config": {"effort": "max"},
        }
    }


def test_resolve_options_maps_reasoning_effort_for_budget_models() -> None:
    mapped = anthropic_oauth_provider.resolve_options(
        "claude-sonnet-4-5",
        {"reasoning_effort": "medium"},
        None,
    )

    assert mapped == {
        "request_params": {
            "thinking": {"type": "enabled", "budget_tokens": 8192}
        }
    }


def test_resolve_options_omits_reasoning_for_auto() -> None:
    mapped = anthropic_oauth_provider.resolve_options(
        "claude-sonnet-4-5",
        {"reasoning_effort": "auto"},
        None,
    )
    assert "request_params" not in mapped


def test_fetch_models_includes_reasoning_metadata_from_listing(monkeypatch) -> None:
    captured: dict[str, str] = {}

    class FakeOauthManager:
        def get_valid_credentials(self, provider: str):
            if provider == "anthropic_oauth":
                return {"access_token": "token"}
            return None

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "id": "claude-opus-4-6",
                        "display_name": "Claude Opus 4.6",
                        "supported_reasoning_levels": [
                            {"effort": "low"},
                            {"effort": "high"},
                            {"effort": "max"},
                        ],
                        "default_reasoning_level": "high",
                    },
                    {
                        "id": "claude-sonnet-4-5",
                        "display_name": "Claude Sonnet 4.5",
                    },
                ]
            },
        )

    transport = httpx.MockTransport(handler)
    real_async_client = anthropic_oauth_provider.httpx.AsyncClient

    def fake_async_client(*args, **kwargs):
        return real_async_client(transport=transport, timeout=kwargs.get("timeout"))

    monkeypatch.setattr(
        anthropic_oauth_provider,
        "get_provider_oauth_manager",
        lambda: FakeOauthManager(),
    )
    monkeypatch.setattr(
        anthropic_oauth_provider.httpx,
        "AsyncClient",
        fake_async_client,
    )

    models = asyncio.run(anthropic_oauth_provider.fetch_models())

    assert captured == {"path": "/v1/models"}
    assert models[0] == {
        "id": "claude-opus-4-6",
        "name": "Claude Opus 4.6",
        "supported_reasoning_levels": [
            {"effort": "low"},
            {"effort": "high"},
            {"effort": "max"},
        ],
        "default_reasoning_level": "high",
    }
    assert models[1]["id"] == "claude-sonnet-4-5"
    assert models[1]["default_reasoning_level"] == "auto"
    assert models[1]["supported_reasoning_levels"] == [
        {"effort": "low"},
        {"effort": "medium"},
        {"effort": "high"},
    ]
