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
from ..services.model_factory import (
    get_available_models as get_models_from_factory,
)
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
    """
    Get the database directory path for file access.
    
    Returns:
        The absolute path to the database directory
    """
    return DbPathResponse(path=str(get_db_directory()))


@command
async def get_available_models() -> AvailableModelsResponse:
    """
    Get list of available models based on configured providers.
    
    Fetches from all enabled providers in parallel for maximum speed.

    Returns:
        List of available models with provider, modelId, displayName, and isDefault
    """
    models_data = await get_models_from_factory()
    models = [
        ModelInfo(
            provider=m["provider"],
            modelId=m["modelId"],
            displayName=m["displayName"],
            isDefault=m["isDefault"],
        )
        for m in models_data
    ]
    return AvailableModelsResponse(models=models)


@command
async def get_provider_settings() -> AllProvidersResponse:
    """
    Get all configured provider settings.

    Returns:
        List of provider configurations
    """
    with db.db_session() as sess:
        db_settings = db.get_all_provider_settings(sess)

    providers = []
    for provider, config in db_settings.items():
        providers.append(
            ProviderConfig(
                provider=provider,
                apiKey=config.get("api_key"),
                baseUrl=config.get("base_url"),
                extra=_safe_parse_json(config.get("extra")),
                enabled=config.get("enabled", True),
            )
        )

    return AllProvidersResponse(providers=providers)


@command
async def save_provider_settings(body: SaveProviderConfigInput) -> None:
    """
    Save or update provider settings.

    Args:
        body: Provider configuration to save
    """
    with db.db_session() as sess:
        db.save_provider_settings(
            sess,
            provider=body.provider,
            api_key=body.apiKey,
            base_url=body.baseUrl,
            extra=body.extra,
            enabled=body.enabled,
        )

    return None


def _safe_parse_json(value: str | None):
    if not value:
        return None
    try:
        import json

        return json.loads(value)
    except Exception:
        return None


@command
async def get_default_tools() -> DefaultToolsResponse:
    """
    Get default tool IDs for new chats.

    Returns:
        List of default tool IDs
    """
    with db.db_session() as sess:
        tool_ids = db.get_default_tool_ids(sess)

    return DefaultToolsResponse(toolIds=tool_ids)


@command
async def set_default_tools(body: SetDefaultToolsInput) -> None:
    """
    Set default tool IDs for new chats.

    Args:
        body: Contains list of tool IDs to set as defaults
    """
    with db.db_session() as sess:
        db.set_default_tool_ids(sess, body.toolIds)

    return None


@command
async def get_auto_title_settings() -> AutoTitleSettings:
    """
    Get auto-title generation settings.

    Returns:
        Auto-title settings including enabled, prompt, and model configuration
    """
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
    """
    Save auto-title generation settings.

    Args:
        body: Auto-title settings to save
    """
    with db.db_session() as sess:
        settings = {
            "enabled": body.enabled,
            "prompt": body.prompt,
            "model_mode": body.modelMode,
            "provider": body.provider,
            "model_id": body.modelId,
        }
        db.save_auto_title_settings(sess, settings)

    return None


@command
async def get_model_settings() -> AllModelSettingsResponse:
    """
    Get all model settings including reasoning capabilities.

    Returns:
        List of model settings with reasoning support flags
    """
    with db.db_session() as sess:
        models = db.get_all_model_settings(sess)

    result = []
    for model in models:
        reasoning = db.get_reasoning_from_model(model)

        # Get thinkingTagPrompted from extra
        from ..db.model_ops import _parse_extra

        extra = _parse_extra(model.extra)
        thinking_tag_prompted = extra.get("thinkingTagPrompted", {})

        result.append(
            ModelSettingsInfo(
                provider=model.provider,
                modelId=model.model_id,
                parseThinkTags=model.parse_think_tags,
                reasoning=ReasoningInfo(
                    supports=reasoning.get("supports", False),
                    isUserOverride=reasoning.get("isUserOverride", False),
                ),
                thinkingTagPrompted=ThinkingTagPromptInfo(
                    prompted=thinking_tag_prompted.get("prompted", False),
                    declined=thinking_tag_prompted.get("declined", False),
                )
                if thinking_tag_prompted
                else None,
            )
        )

    return AllModelSettingsResponse(models=result)


@command
async def save_model_settings(body: SaveModelSettingsInput) -> None:
    """
    Save or update model settings (including reasoning support).

    Args:
        body: Model settings to save
    """
    with db.db_session() as sess:
        reasoning_dict = None
        if body.reasoning:
            reasoning_dict = {
                "supports": body.reasoning.supports,
                "isUserOverride": body.reasoning.isUserOverride,
            }

        db.save_model_settings(
            sess,
            provider=body.provider,
            model_id=body.modelId,
            parse_think_tags=body.parseThinkTags,
            reasoning=reasoning_dict,
        )

    return None


class RespondToThinkingTagPromptInput(BaseModel):
    provider: str
    modelId: str
    accepted: bool


@command
async def respond_to_thinking_tag_prompt(
    body: RespondToThinkingTagPromptInput,
) -> None:
    """
    Handle user response to thinking tag detection prompt.

    If accepted, enables parse_think_tags setting.
    If declined, stores thinkingTagPrompted: { prompted: true, declined: true } in extra.

    Args:
        body: User's response
    """
    with db.db_session() as sess:
        extra_update = {
            "thinkingTagPrompted": {
                "prompted": True,
                "declined": not body.accepted,
            }
        }

        db.save_model_settings(
            sess,
            provider=body.provider,
            model_id=body.modelId,
            parse_think_tags=body.accepted,
            extra=extra_update,
        )

    return None


class TestProviderInput(BaseModel):
    """Input for testing provider connection."""
    provider: str


class TestProviderResponse(BaseModel):
    """Response from testing provider connection."""
    success: bool
    error: str | None = None


@command
async def test_provider(body: TestProviderInput) -> TestProviderResponse:
    """
    Test if a provider connection is valid.
    
    Uses each provider's built-in test_connection() function
    which validates credentials and connectivity.
    
    Args:
        body: Contains provider name to test
        
    Returns:
        Success status and optional error message
    """
    
    success, error = await test_provider_connection(body.provider)
    return TestProviderResponse(success=success, error=error)
