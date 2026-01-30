from __future__ import annotations

import sys

from pydantic import BaseModel

from zynk import command

from .. import db
from ..config import get_db_directory
from ..models.chat import (
    AllModelSettingsResponse,
    AllProvidersResponse,
    AutoTitleSettings,
    AvailableModelsResponse,
    DefaultToolsResponse,
    ModelInfo,
    ModelSettingsInfo,
    ProviderConfig,
    ReasoningInfo,
    SaveAutoTitleSettingsInput,
    SaveModelSettingsInput,
    SaveProviderConfigInput,
    SetDefaultToolsInput,
    ThinkingTagPromptInfo,
)
from ..services.model_factory import get_available_models as get_models_from_factory
from ..providers import test_provider_connection


class Person(BaseModel):
    name: str


class Greeting(BaseModel):
    message: str


@command
async def greet(body: Person) -> Greeting:
    return Greeting(
        message=f"Hello, {body.name}! You've been greeted from Python: {sys.version}!"
    )


@command
async def get_version() -> str:
    return sys.version


class DbPathResponse(BaseModel):
    path: str


@command
async def get_db_path() -> DbPathResponse:
    return DbPathResponse(path=str(get_db_directory()))


@command
async def get_available_models() -> AvailableModelsResponse:
    models_data, connected_providers = await get_models_from_factory()
    return AvailableModelsResponse(
        models=[
            ModelInfo(
                provider=m["provider"],
                modelId=m["modelId"],
                displayName=m["displayName"],
                isDefault=m["isDefault"],
            )
            for m in models_data
        ],
        connectedProviders=connected_providers,
    )


@command
async def get_provider_settings() -> AllProvidersResponse:
    with db.db_session() as sess:
        db_settings = db.get_all_provider_settings(sess)
    return AllProvidersResponse(
        providers=[
            ProviderConfig(
                provider=provider,
                apiKey=config.get("api_key"),
                baseUrl=config.get("base_url"),
                extra=_safe_parse_json(config.get("extra")),
                enabled=config.get("enabled", True),
            )
            for provider, config in db_settings.items()
        ]
    )


@command
async def save_provider_settings(body: SaveProviderConfigInput) -> None:
    with db.db_session() as sess:
        db.save_provider_settings(
            sess,
            provider=body.provider,
            api_key=body.apiKey,
            base_url=body.baseUrl,
            extra=body.extra,
            enabled=body.enabled,
        )


def _safe_parse_json(value: str | None):
    import json

    if not value:
        return None
    try:
        return json.loads(value)
    except Exception:
        return None


@command
async def get_default_tools() -> DefaultToolsResponse:
    with db.db_session() as sess:
        return DefaultToolsResponse(toolIds=db.get_default_tool_ids(sess))


@command
async def set_default_tools(body: SetDefaultToolsInput) -> None:
    with db.db_session() as sess:
        db.set_default_tool_ids(sess, body.toolIds)


@command
async def get_auto_title_settings() -> AutoTitleSettings:
    with db.db_session() as sess:
        settings = db.get_auto_title_settings(sess)
    return AutoTitleSettings(
        enabled=settings.get("enabled", True),
        prompt=settings.get(
            "prompt",
            "Generate a brief, descriptive title (max 6 words) for this conversation based on the user's message: {{ message }}\n\nReturn only the title, nothing else.",
        ),
        modelMode=settings.get("model_mode", "current"),
        provider=settings.get("provider", "openai"),
        modelId=settings.get("model_id", "gpt-4o-mini"),
    )


@command
async def save_auto_title_settings(body: SaveAutoTitleSettingsInput) -> None:
    with db.db_session() as sess:
        db.save_auto_title_settings(
            sess,
            {
                "enabled": body.enabled,
                "prompt": body.prompt,
                "model_mode": body.modelMode,
                "provider": body.provider,
                "model_id": body.modelId,
            },
        )


@command
async def get_model_settings() -> AllModelSettingsResponse:
    from ..db.model_ops import _parse_extra

    with db.db_session() as sess:
        models = db.get_all_model_settings(sess)
    return AllModelSettingsResponse(
        models=[
            ModelSettingsInfo(
                provider=model.provider,
                modelId=model.model_id,
                parseThinkTags=model.parse_think_tags,
                reasoning=ReasoningInfo(
                    supports=(reasoning := db.get_reasoning_from_model(model)).get(
                        "supports", False
                    ),
                    isUserOverride=reasoning.get("isUserOverride", False),
                ),
                thinkingTagPrompted=ThinkingTagPromptInfo(
                    prompted=thinking_tag_prompted.get("prompted", False),
                    declined=thinking_tag_prompted.get("declined", False),
                )
                if (
                    thinking_tag_prompted := _parse_extra(model.extra).get(
                        "thinkingTagPrompted", {}
                    )
                )
                else None,
            )
            for model in models
        ]
    )


@command
async def save_model_settings(body: SaveModelSettingsInput) -> None:
    with db.db_session() as sess:
        db.save_model_settings(
            sess,
            provider=body.provider,
            model_id=body.modelId,
            parse_think_tags=body.parseThinkTags,
            reasoning={
                "supports": body.reasoning.supports,
                "isUserOverride": body.reasoning.isUserOverride,
            }
            if body.reasoning
            else None,
        )


class RespondToThinkingTagPromptInput(BaseModel):
    provider: str
    modelId: str
    accepted: bool


@command
async def respond_to_thinking_tag_prompt(body: RespondToThinkingTagPromptInput) -> None:
    with db.db_session() as sess:
        db.save_model_settings(
            sess,
            provider=body.provider,
            model_id=body.modelId,
            parse_think_tags=body.accepted,
            extra={
                "thinkingTagPrompted": {"prompted": True, "declined": not body.accepted}
            },
        )


class TestProviderInput(BaseModel):
    provider: str
    apiKey: str | None = None
    baseUrl: str | None = None


class TestProviderResponse(BaseModel):
    success: bool
    error: str | None = None


@command
async def test_provider(body: TestProviderInput) -> TestProviderResponse:
    success, error = await test_provider_connection(
        body.provider, api_key=body.apiKey, base_url=body.baseUrl
    )
    return TestProviderResponse(success=success, error=error)
