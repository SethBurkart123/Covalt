from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Any, Dict, List

from ..providers import get_model as get_provider_model
from ..providers import fetch_provider_models, list_providers
from .. import db
from .provider_oauth_manager import get_provider_oauth_manager

PROVIDER_MODELS_TIMEOUT_SECONDS = 12


def get_model(provider: str, model_id: str, **kwargs: Any) -> Any:
    return get_provider_model(provider, model_id, **kwargs)


def list_supported_providers() -> List[str]:
    return list_providers()


def get_enabled_providers() -> List[str]:
    configured = _get_configured_providers()
    return [provider for provider, config in configured.items() if config.get("enabled", True)]


async def stream_available_model_batches() -> AsyncIterator[tuple[str, List[Dict[str, Any]], bool]]:
    configured = _get_configured_providers()
    enabled = [(p, c) for p, c in configured.items() if c.get("enabled", True)]

    if not enabled:
        return

    async def fetch_one(provider: str) -> tuple[str, List[Dict[str, Any]], bool]:
        try:
            models = await asyncio.wait_for(
                fetch_provider_models(provider),
                timeout=PROVIDER_MODELS_TIMEOUT_SECONDS,
            )
            return (
                provider,
                [
                    {
                        "provider": provider,
                        "modelId": m["id"],
                        "displayName": m["name"],
                        "isDefault": False,
                    }
                    for m in models
                ],
                False,
            )
        except asyncio.TimeoutError:
            print(
                f"[{provider}] Error fetching models: timed out after {PROVIDER_MODELS_TIMEOUT_SECONDS}s"
            )
            return provider, [], True
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[{provider}] Error fetching models: {e}")
            return provider, [], True

    tasks = [asyncio.create_task(fetch_one(provider)) for provider, _ in enabled]
    try:
        for task in asyncio.as_completed(tasks):
            provider, models, has_error = await task
            yield provider, models, has_error
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


def _get_configured_providers() -> Dict[str, Dict[str, Any]]:
    with db.db_session() as sess:
        configured = db.get_all_provider_settings(sess)

    oauth_providers = [
        "anthropic_oauth",
        "openai_codex",
        "github_copilot",
        "google_gemini_cli",
    ]
    oauth_manager = get_provider_oauth_manager()
    for provider in oauth_providers:
        if provider not in configured:
            configured[provider] = {
                "provider": provider,
                "api_key": None,
                "base_url": None,
                "extra": None,
                "enabled": oauth_manager.has_valid_tokens(provider),
            }
    return configured
