from __future__ import annotations

import asyncio
from typing import Any

import pytest

from backend.services import model_factory


@pytest.mark.asyncio
async def test_stream_available_model_batches_yields_completion_order(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_fetch_provider_models(provider: str) -> list[dict[str, str]]:
        if provider == "fast":
            await asyncio.sleep(0.01)
            return [{"id": "fast-model", "name": "Fast"}]
        if provider == "mid":
            await asyncio.sleep(0.02)
            return [{"id": "mid-model", "name": "Mid"}]
        await asyncio.sleep(0.04)
        raise RuntimeError("boom")

    monkeypatch.setattr(
        model_factory,
        "_get_configured_providers",
        lambda: {
            "slow_fail": {"enabled": True},
            "fast": {"enabled": True},
            "mid": {"enabled": True},
        },
    )
    monkeypatch.setattr(
        model_factory,
        "fetch_provider_models",
        fake_fetch_provider_models,
    )

    results = [
        item async for item in model_factory.stream_available_model_batches()
    ]

    assert [provider for provider, _, _ in results] == ["fast", "mid", "slow_fail"]
    assert results[0][2] is False
    assert results[1][2] is False
    assert results[2][2] is True


@pytest.mark.asyncio
async def test_stream_available_model_batches_marks_timeout_as_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_fetch_provider_models(_provider: str) -> list[dict[str, str]]:
        await asyncio.sleep(0.05)
        return [{"id": "never", "name": "Never"}]

    monkeypatch.setattr(
        model_factory,
        "_get_configured_providers",
        lambda: {"timeout_provider": {"enabled": True}},
    )
    monkeypatch.setattr(
        model_factory,
        "fetch_provider_models",
        fake_fetch_provider_models,
    )
    monkeypatch.setattr(model_factory, "PROVIDER_MODELS_TIMEOUT_SECONDS", 0.01)

    results = [
        item async for item in model_factory.stream_available_model_batches()
    ]

    assert results == [("timeout_provider", [], True)]


@pytest.mark.asyncio
async def test_stream_available_model_batches_cancels_pending_tasks_on_close(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    slow_cancelled = asyncio.Event()
    slow_release = asyncio.Event()

    async def fake_fetch_provider_models(provider: str) -> list[dict[str, Any]]:
        if provider == "fast":
            await asyncio.sleep(0.01)
            return [{"id": "fast-model", "name": "Fast"}]

        try:
            await slow_release.wait()
        except asyncio.CancelledError:
            slow_cancelled.set()
            raise

        return [{"id": "slow-model", "name": "Slow"}]

    monkeypatch.setattr(
        model_factory,
        "_get_configured_providers",
        lambda: {"slow": {"enabled": True}, "fast": {"enabled": True}},
    )
    monkeypatch.setattr(
        model_factory,
        "fetch_provider_models",
        fake_fetch_provider_models,
    )

    stream = model_factory.stream_available_model_batches()
    first = await anext(stream)
    assert first[0] == "fast"

    await stream.aclose()
    await asyncio.wait_for(slow_cancelled.wait(), timeout=0.5)
