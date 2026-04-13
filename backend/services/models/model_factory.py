from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Any

import orjson

from ... import db
from ...models.chat import OptionSchema
from ...providers import fetch_provider_models, get_provider_model_options, list_providers
from ...providers import get_model as get_provider_model
from .model_schema_cache import cache_model_metadata
from .provider_oauth_manager import get_provider_oauth_manager

PROVIDER_MODELS_TIMEOUT_SECONDS = 12


def _get_extra_models(provider_config: dict[str, Any]) -> list[str]:
    extra_raw = provider_config.get("extra")
    if not extra_raw:
        return []
    try:
        extra = orjson.loads(extra_raw) if isinstance(extra_raw, str) else extra_raw
        models = extra.get("extraModels", [])
        return [m.strip() for m in models if isinstance(m, str) and m.strip()]
    except (ValueError, TypeError, AttributeError):
        return []


def get_model(
    provider: str,
    model_id: str,
    provider_options: dict[str, Any] | None = None,
) -> Any:
    return get_provider_model(provider, model_id, provider_options=provider_options)


def list_supported_providers() -> list[str]:
    return list_providers()


def get_enabled_providers() -> list[str]:
    return list(_get_configured_providers().keys())


async def stream_available_model_batches() -> AsyncIterator[tuple[str, list[dict[str, Any]], bool]]:
    configured = _get_configured_providers()

    if not configured:
        return

    async def fetch_one(provider: str) -> tuple[str, list[dict[str, Any]], bool]:
        try:
            models = await asyncio.wait_for(
                fetch_provider_models(provider),
                timeout=PROVIDER_MODELS_TIMEOUT_SECONDS,
            )
            provider_models: list[dict[str, Any]] = []
            for model in models:
                model_id = str(model.get("id") or "").strip()
                if not model_id:
                    continue

                metadata = {
                    key: value for key, value in model.items() if key not in {"id", "name"}
                }
                cache_model_metadata(provider, model_id, metadata)

                try:
                    schema_dict = get_provider_model_options(
                        provider,
                        model_id,
                        metadata or None,
                    )
                    options = OptionSchema.model_validate(schema_dict).model_dump()
                except Exception as exc:
                    print(
                        f"[{provider}] Failed generating options schema for {model_id}: {exc}"
                    )
                    options = OptionSchema(main=[], advanced=[]).model_dump()

                provider_models.append(
                    {
                        "provider": provider,
                        "modelId": model_id,
                        "displayName": str(model.get("name") or model_id),
                        "isDefault": False,
                        "options": options,
                    }
                )

            extra_models = _get_extra_models(configured.get(provider, {}))
            existing_ids = {m["modelId"] for m in provider_models}
            for model_id in extra_models:
                if model_id in existing_ids:
                    continue
                try:
                    schema_dict = get_provider_model_options(provider, model_id, None)
                    options = OptionSchema.model_validate(schema_dict).model_dump()
                except Exception:
                    options = OptionSchema(main=[], advanced=[]).model_dump()
                provider_models.append(
                    {
                        "provider": provider,
                        "modelId": model_id,
                        "displayName": model_id,
                        "isDefault": False,
                        "options": options,
                    }
                )

            return (
                provider,
                provider_models,
                False,
            )
        except TimeoutError:
            print(
                f"[{provider}] Error fetching models: timed out after {PROVIDER_MODELS_TIMEOUT_SECONDS}s"
            )
            return provider, [], True
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[{provider}] Error fetching models: {e}")
            return provider, [], True

    tasks = [asyncio.create_task(fetch_one(provider)) for provider in configured]
    try:
        for task in asyncio.as_completed(tasks):
            provider, models, has_error = await task
            yield provider, models, has_error
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


def _get_configured_providers() -> dict[str, dict[str, Any]]:
    with db.db_session() as sess:
        configured = db.get_all_provider_settings(sess)

    oauth_providers = {
        "openai_codex",
        "github_copilot",
    }
    oauth_plugin_provider_ids = {"anthropic_oauth", "google_gemini_cli"}
    oauth_providers.update(
        provider for provider in list_providers() if provider in oauth_plugin_provider_ids
    )

    oauth_manager = get_provider_oauth_manager()
    for provider in sorted(oauth_providers):
        has_tokens = oauth_manager.has_valid_tokens(provider)
        if provider not in configured and has_tokens:
            configured[provider] = {
                "provider": provider,
                "api_key": None,
                "base_url": None,
                "extra": None,
            }

    return configured
