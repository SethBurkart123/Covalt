from __future__ import annotations

import asyncio

import httpx
import pytest
from agno.media import Image
from agno.models.message import Message

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
        def get_valid_credentials(self, provider: str, **kwargs):
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


def test_convert_messages_includes_user_images(tmp_path) -> None:
    image_path = tmp_path / "screenshot.png"
    image_bytes = b"\x89PNG\r\n\x1a\nfake"
    image_path.write_bytes(image_bytes)
    message = Message(
        role="user",
        content="what is in this screenshot?",
        images=[Image(filepath=image_path)],
    )

    converted = anthropic_oauth_provider._convert_messages([message])

    assert len(converted) == 1
    assert converted[0]["role"] == "user"
    blocks = converted[0]["content"]
    assert isinstance(blocks, list)
    assert blocks[0] == {"type": "text", "text": "what is in this screenshot?"}
    assert blocks[1]["type"] == "image"
    assert blocks[1]["source"]["type"] == "base64"
    assert blocks[1]["source"]["media_type"] == "image/png"


def test_convert_messages_falls_back_svg_image_to_document(tmp_path) -> None:
    image_path = tmp_path / "diagram.svg"
    image_path.write_text("<svg xmlns='http://www.w3.org/2000/svg'></svg>")
    message = Message(
        role="user",
        content="please inspect this asset",
        images=[Image(filepath=image_path)],
    )

    converted = anthropic_oauth_provider._convert_messages([message])

    assert len(converted) == 1
    blocks = converted[0]["content"]
    assert isinstance(blocks, list)
    assert blocks[1]["type"] == "document"
    assert blocks[1]["source"]["type"] == "text"
    assert blocks[1]["source"]["media_type"] == "text/plain"


def test_convert_messages_does_not_fetch_remote_image_urls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    called = {"count": 0}

    def fail_get(*_args, **_kwargs):
        called["count"] += 1
        raise AssertionError("httpx.get should not be called for image URL loading")

    monkeypatch.setattr(anthropic_oauth_provider.httpx, "get", fail_get)
    message = Message(
        role="user",
        content="describe this URL image",
        images=[Image(url="https://example.com/screenshot.png")],
    )

    converted = anthropic_oauth_provider._convert_messages([message])

    assert len(converted) == 1
    assert converted[0]["content"] == "describe this URL image"
    assert called["count"] == 0


def test_apply_cache_control_skips_image_only_latest_user_message() -> None:
    params = [
        {"role": "user", "content": [{"type": "text", "text": "older"}]},
        {
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": "AAAA",
                    },
                }
            ],
        },
    ]

    anthropic_oauth_provider._apply_cache_control(params, {"type": "ephemeral"})

    assert "cache_control" not in params[0]["content"][0]
    assert "cache_control" not in params[1]["content"][0]
