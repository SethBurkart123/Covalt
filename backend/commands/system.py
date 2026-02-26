from __future__ import annotations

import sys

from pydantic import BaseModel, Field

from zynk import Channel, command

from .. import db
from ..config import get_db_directory
from ..models.chat import (
    AllModelSettingsResponse,
    AllProvidersResponse,
    AutoTitleSettings,
    DefaultToolsResponse,
    ModelInfo,
    ModelSettingsInfo,
    ProviderCatalogItem,
    ProviderCatalogResponse,
    ProviderConfig,
    ProviderOverview,
    ProviderOverviewResponse,
    ProviderOAuthInfo,
    ReasoningInfo,
    SaveAutoTitleSettingsInput,
    SaveModelSettingsInput,
    SaveProviderConfigInput,
    SaveSystemPromptSettingsInput,
    SetDefaultToolsInput,
    SystemPromptSettings,
    ThinkingTagPromptInfo,
)
from ..services.model_factory import (
    get_enabled_providers as get_enabled_providers_from_factory,
    stream_available_model_batches as stream_model_batches_from_factory,
)
from ..providers import test_provider_connection
from ..services.provider_oauth_manager import get_provider_oauth_manager
from ..services.provider_catalog import list_provider_catalog


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


class AvailableModelsEvent(BaseModel):
    event: str
    provider: str | None = None
    models: list[ModelInfo] = Field(default_factory=list)
    connectedProviders: list[str] = Field(default_factory=list)
    expectedProviders: list[str] = Field(default_factory=list)


@command
async def get_db_path() -> DbPathResponse:
    return DbPathResponse(path=str(get_db_directory()))


@command
async def stream_available_models(channel: Channel) -> None:
    enabled_providers = get_enabled_providers_from_factory()
    connected_providers: set[str] = set()

    def connected_in_order() -> list[str]:
        return [provider for provider in enabled_providers if provider in connected_providers]

    channel.send_model(
        AvailableModelsEvent(
            event="ModelsStarted",
            expectedProviders=enabled_providers,
        )
    )

    async for provider, models_data, has_error in stream_model_batches_from_factory():
        if has_error:
            connected_providers.discard(provider)
            channel.send_model(
                AvailableModelsEvent(
                    event="ModelsFailed",
                    provider=provider,
                    connectedProviders=connected_in_order(),
                )
            )
            continue

        batch_models = [
            ModelInfo(
                provider=m["provider"],
                modelId=m["modelId"],
                displayName=m["displayName"],
                isDefault=False,
                options=m.get("options"),
            )
            for m in models_data
        ]

        if batch_models:
            connected_providers.add(provider)
        else:
            connected_providers.discard(provider)

        channel.send_model(
            AvailableModelsEvent(
                event="ModelsBatch",
                provider=provider,
                models=batch_models,
                connectedProviders=connected_in_order(),
            )
        )

    channel.send_model(
        AvailableModelsEvent(
            event="ModelsCompleted",
            connectedProviders=connected_in_order(),
            expectedProviders=enabled_providers,
        )
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
async def get_provider_catalog() -> ProviderCatalogResponse:
    providers = [
        ProviderCatalogItem(
            key=entry.key,
            provider=entry.provider,
            name=entry.name,
            description=entry.description,
            icon=entry.icon,
            authType=entry.auth_type,
            defaultBaseUrl=entry.default_base_url,
            defaultEnabled=entry.default_enabled,
            oauthVariant=entry.oauth_variant,
            oauthEnterpriseDomain=entry.oauth_enterprise_domain,
            aliases=entry.aliases,
        )
        for entry in list_provider_catalog()
    ]
    return ProviderCatalogResponse(providers=providers)


class ProviderOverviewInput(BaseModel):
    providers: list[str]


@command
async def get_provider_overview(
    body: ProviderOverviewInput,
) -> ProviderOverviewResponse:
    with db.db_session() as sess:
        db_settings = db.get_all_provider_settings(sess)

    provider_keys = [p for p in body.providers if p]
    oauth_manager = get_provider_oauth_manager()
    providers: list[ProviderOverview] = []

    for provider in provider_keys:
        canonical_provider = db.normalize_provider(provider)
        config = db_settings.get(canonical_provider, {})
        oauth_status = oauth_manager.get_oauth_status(canonical_provider)
        oauth = ProviderOAuthInfo(
            status=oauth_status.get("status", "none"),
            hasTokens=oauth_status.get("hasTokens", False),
            authUrl=oauth_status.get("authUrl"),
            instructions=oauth_status.get("instructions"),
            error=oauth_status.get("error"),
        )
        enabled = config.get("enabled", True)
        has_api_key = bool(config.get("api_key"))
        connected = bool(enabled and (oauth.status == "authenticated" or has_api_key))

        providers.append(
            ProviderOverview(
                provider=provider,
                apiKey=config.get("api_key"),
                baseUrl=config.get("base_url"),
                extra=_safe_parse_json(config.get("extra")),
                enabled=enabled,
                connected=connected,
                oauth=oauth,
            )
        )

    return ProviderOverviewResponse(providers=providers)


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
async def get_system_prompt_settings() -> SystemPromptSettings:
    with db.db_session() as sess:
        prompt = db.get_system_prompt_setting(sess)
    return SystemPromptSettings(prompt=prompt)


@command
async def save_system_prompt_settings(body: SaveSystemPromptSettingsInput) -> None:
    with db.db_session() as sess:
        db.save_system_prompt_setting(sess, body.prompt)


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
