"""Tests for the OpenAI-compatible provider adapter."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.providers.adapters.openai_compatible import create_provider


def test_create_provider_returns_required_keys():
    entry = create_provider(provider_id="test_provider", base_url="https://api.test.com/v1")
    assert "get_model" in entry
    assert "fetch_models" in entry
    assert "test_connection" in entry
    assert callable(entry["get_model"])
    assert callable(entry["fetch_models"])
    assert callable(entry["test_connection"])


def test_get_model_returns_litellm_with_correct_id_and_base():
    entry = create_provider(provider_id="test_provider", base_url="https://api.test.com/v1")
    with patch(
        "backend.providers.adapters.openai_compatible.get_credentials",
        return_value=("sk-test", None),
    ):
        model = entry["get_model"]("gpt-4o", provider_options={})
    assert model.id == "openai/gpt-4o"
    assert model.api_base == "https://api.test.com/v1"
    assert model.api_key == "sk-test"


def test_get_model_uses_custom_base_url_over_default():
    entry = create_provider(provider_id="test_provider", base_url="https://default.com/v1")
    with patch(
        "backend.providers.adapters.openai_compatible.get_credentials",
        return_value=("sk-test", "https://custom.com/v1"),
    ):
        model = entry["get_model"]("gpt-4o", provider_options={})
    assert model.api_base == "https://custom.com/v1"


def test_get_model_raises_without_base_url():
    entry = create_provider(provider_id="no_url_provider")
    with patch(
        "backend.providers.adapters.openai_compatible.get_credentials",
        return_value=("sk-test", None),
    ):
        with pytest.raises(RuntimeError, match="Base URL not configured"):
            entry["get_model"]("gpt-4o", provider_options={})


def test_get_model_uses_custom_as_default_api_key():
    entry = create_provider(provider_id="test_provider", base_url="https://api.test.com/v1")
    with patch(
        "backend.providers.adapters.openai_compatible.get_credentials",
        return_value=(None, None),
    ):
        model = entry["get_model"]("gpt-4o", provider_options={})
    assert model.api_key == "custom"


@pytest.mark.asyncio
async def test_fetch_models_delegates_to_shared_endpoint():
    entry = create_provider(provider_id="test_provider", base_url="https://api.test.com/v1")
    mock_fetch = AsyncMock(return_value=[{"id": "model-1", "name": "model-1"}])
    with (
        patch(
            "backend.providers.adapters.openai_compatible.get_credentials",
            return_value=("sk-test", None),
        ),
        patch(
            "backend.providers.adapters.openai_compatible._fetch_from_openai_endpoint",
            mock_fetch,
        ),
    ):
        result = await entry["fetch_models"]()

    mock_fetch.assert_awaited_once_with("https://api.test.com/v1", "sk-test")
    assert result == [{"id": "model-1", "name": "model-1"}]


@pytest.mark.asyncio
async def test_fetch_models_returns_empty_without_base_url():
    entry = create_provider(provider_id="no_url_provider")
    with patch(
        "backend.providers.adapters.openai_compatible.get_credentials",
        return_value=("sk-test", None),
    ):
        result = await entry["fetch_models"]()
    assert result == []


@pytest.mark.asyncio
async def test_test_connection_success():
    entry = create_provider(provider_id="test_provider", base_url="https://api.test.com/v1")
    mock_response = MagicMock(is_success=True)
    mock_client = AsyncMock()
    mock_client.get.return_value = mock_response
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with (
        patch(
            "backend.providers.adapters.openai_compatible.get_credentials",
            return_value=("sk-test", None),
        ),
        patch("backend.providers.adapters.openai_compatible.httpx.AsyncClient", return_value=mock_client),
    ):
        ok, err = await entry["test_connection"]()

    assert ok is True
    assert err is None


@pytest.mark.asyncio
async def test_test_connection_no_api_key():
    entry = create_provider(provider_id="test_provider", base_url="https://api.test.com/v1")
    with patch(
        "backend.providers.adapters.openai_compatible.get_credentials",
        return_value=(None, None),
    ):
        ok, err = await entry["test_connection"]()
    assert ok is False
    assert err == "API key not configured"


@pytest.mark.asyncio
async def test_test_connection_401():
    entry = create_provider(provider_id="test_provider", base_url="https://api.test.com/v1")
    mock_response = MagicMock(is_success=False, status_code=401)
    mock_client = AsyncMock()
    mock_client.get.return_value = mock_response
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with (
        patch(
            "backend.providers.adapters.openai_compatible.get_credentials",
            return_value=("sk-test", None),
        ),
        patch("backend.providers.adapters.openai_compatible.httpx.AsyncClient", return_value=mock_client),
    ):
        ok, err = await entry["test_connection"]()

    assert ok is False
    assert err == "Invalid API key"


def test_credential_lookup_uses_provider_id():
    """Verify the factory passes provider_id to get_credentials, bypassing stack inspection."""
    entry = create_provider(provider_id="my_custom_provider", base_url="https://api.test.com/v1")
    mock_creds = MagicMock(return_value=("sk-test", None))
    with patch(
        "backend.providers.adapters.openai_compatible.get_credentials",
        mock_creds,
    ):
        entry["get_model"]("gpt-4o", provider_options={})

    mock_creds.assert_called_once_with(provider_name="my_custom_provider")


@pytest.mark.asyncio
async def test_manifest_providers_all_registered():
    """Spot-check that a few manifest providers are registered in the global PROVIDERS dict."""
    from backend.providers import PROVIDERS

    for pid in ["deepseek", "cerebras", "xai", "mistral", "azure"]:
        assert pid in PROVIDERS, f"Provider '{pid}' not registered"
        assert "get_model" in PROVIDERS[pid]
        assert "fetch_models" in PROVIDERS[pid]
        assert "test_connection" in PROVIDERS[pid]
