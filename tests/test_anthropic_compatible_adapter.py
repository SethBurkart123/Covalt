"""Tests for the Anthropic-compatible provider adapter."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.providers.adapters.anthropic_compatible import create_provider


def test_create_provider_returns_required_keys() -> None:
    entry = create_provider(provider_id="test_provider", base_url="https://api.test.com/v1")
    assert "get_model" in entry
    assert "fetch_models" in entry
    assert "test_connection" in entry


def test_get_model_returns_litellm_with_correct_id_and_base() -> None:
    entry = create_provider(provider_id="test_provider", base_url="https://api.test.com/v1")
    with patch(
        "backend.providers.adapters.anthropic_compatible.get_credentials",
        return_value=("sk-test", None),
    ):
        model = entry["get_model"]("claude-3-5-sonnet", provider_options={})

    assert model.id == "anthropic/claude-3-5-sonnet"
    assert model.api_base == "https://api.test.com/v1"
    assert model.api_key == "sk-test"


def test_get_model_uses_custom_base_url_over_default() -> None:
    entry = create_provider(provider_id="test_provider", base_url="https://default.com/v1")
    with patch(
        "backend.providers.adapters.anthropic_compatible.get_credentials",
        return_value=("sk-test", "https://custom.com/v1"),
    ):
        model = entry["get_model"]("claude-3-5-sonnet", provider_options={})

    assert model.api_base == "https://custom.com/v1"


def test_get_model_raises_without_api_key() -> None:
    entry = create_provider(provider_id="test_provider", base_url="https://api.test.com/v1")
    with patch(
        "backend.providers.adapters.anthropic_compatible.get_credentials",
        return_value=(None, None),
    ):
        with pytest.raises(RuntimeError, match="API key not configured"):
            entry["get_model"]("claude-3-5-sonnet", provider_options={})


@pytest.mark.asyncio
async def test_fetch_models_uses_anthropic_headers() -> None:
    entry = create_provider(provider_id="test_provider", base_url="https://api.test.com/v1")
    mock_response = MagicMock(is_success=True)
    mock_response.json.return_value = {
        "data": [{"id": "claude-3-5-sonnet", "display_name": "Claude 3.5 Sonnet"}]
    }

    mock_client = AsyncMock()
    mock_client.get.return_value = mock_response
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with (
        patch(
            "backend.providers.adapters.anthropic_compatible.get_credentials",
            return_value=("sk-test", None),
        ),
        patch(
            "backend.providers.adapters.anthropic_compatible.httpx.AsyncClient",
            return_value=mock_client,
        ),
    ):
        result = await entry["fetch_models"]()

    assert result == [{"id": "claude-3-5-sonnet", "name": "Claude 3.5 Sonnet"}]


@pytest.mark.asyncio
async def test_test_connection_no_api_key() -> None:
    entry = create_provider(provider_id="test_provider", base_url="https://api.test.com/v1")
    with patch(
        "backend.providers.adapters.anthropic_compatible.get_credentials",
        return_value=(None, None),
    ):
        ok, err = await entry["test_connection"]()

    assert ok is False
    assert err == "API key not configured"


@pytest.mark.asyncio
async def test_test_connection_no_base_url() -> None:
    entry = create_provider(provider_id="test_provider")
    with patch(
        "backend.providers.adapters.anthropic_compatible.get_credentials",
        return_value=("sk-test", None),
    ):
        ok, err = await entry["test_connection"]()

    assert ok is False
    assert err == "Base URL not configured"


@pytest.mark.asyncio
async def test_test_connection_success() -> None:
    entry = create_provider(provider_id="test_provider", base_url="https://api.test.com/v1")
    mock_response = MagicMock(is_success=True, status_code=200)
    mock_client = AsyncMock()
    mock_client.get.return_value = mock_response
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with (
        patch(
            "backend.providers.adapters.anthropic_compatible.get_credentials",
            return_value=("sk-test", None),
        ),
        patch(
            "backend.providers.adapters.anthropic_compatible.httpx.AsyncClient",
            return_value=mock_client,
        ),
    ):
        ok, err = await entry["test_connection"]()

    assert ok is True
    assert err is None
