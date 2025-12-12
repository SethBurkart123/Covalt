from __future__ import annotations

import sys

from pytauri import AppHandle

from .. import db
from ..types import _BaseModel
from ..models.chat import (
    AvailableModelsResponse,
    ModelInfo,
    AllProvidersResponse,
    ProviderConfig,
    SaveProviderConfigInput,
    DefaultToolsResponse,
    SetDefaultToolsInput,
    AutoTitleSettings,
    SaveAutoTitleSettingsInput,
    AllModelSettingsResponse,
    ModelSettingsInfo,
    SaveModelSettingsInput,
    ReasoningInfo,
    ThinkingTagPromptInfo,
)
from ..services.model_factory import (
    get_available_models as get_models_from_factory,
)
from . import commands


class Person(_BaseModel):
    name: str


class Greeting(_BaseModel):
    message: str


@commands.command()
async def greet(body: Person) -> Greeting:
    return Greeting(message=f"Hello, {body.name}! You've been greeted from Python: {sys.version}!")


@commands.command()
async def get_version() -> str:
    return sys.version


@commands.command()
async def get_available_models(app_handle: AppHandle) -> AvailableModelsResponse:
    """
    Get list of available models based on configured providers.
    
    Returns:
        List of available models with provider, modelId, displayName, and isDefault
    """
    models_data = get_models_from_factory(app_handle)
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


@commands.command()
async def get_provider_settings(app_handle: AppHandle) -> AllProvidersResponse:
    """
    Get all configured provider settings.
    
    Returns:
        List of provider configurations
    """
    sess = db.session(app_handle)
    try:
        db_settings = db.get_all_provider_settings(sess)
    finally:
        sess.close()

    providers = []
    for provider, config in db_settings.items():
        providers.append(
            ProviderConfig(
                provider=provider,
                api_key=config.get("api_key"),
                base_url=config.get("base_url"),
                extra=_safe_parse_json(config.get("extra")),
                enabled=config.get("enabled", True),
            )
        )

    return AllProvidersResponse(providers=providers)


@commands.command()
async def save_provider_settings(body: SaveProviderConfigInput, app_handle: AppHandle) -> None:
    """
    Save or update provider settings.
    
    Args:
        body: Provider configuration to save
        app_handle: Tauri app handle
    """
    sess = db.session(app_handle)
    try:
        db.save_provider_settings(
            sess,
            provider=body.provider,
            api_key=body.api_key,
            base_url=body.base_url,
            extra=body.extra,
            enabled=body.enabled,
        )
    finally:
        sess.close()
    
    return None


def _safe_parse_json(value: str | None):
    if not value:
        return None
    try:
        import json
        return json.loads(value)
    except Exception:
        return None


@commands.command()
async def get_default_tools(app_handle: AppHandle) -> DefaultToolsResponse:
    """
    Get default tool IDs for new chats.
    
    Returns:
        List of default tool IDs
    """
    sess = db.session(app_handle)
    try:
        tool_ids = db.get_default_tool_ids(sess)
    finally:
        sess.close()
    
    return DefaultToolsResponse(toolIds=tool_ids)


@commands.command()
async def set_default_tools(body: SetDefaultToolsInput, app_handle: AppHandle) -> None:
    """
    Set default tool IDs for new chats.
    
    Args:
        body: Contains list of tool IDs to set as defaults
        app_handle: Tauri app handle
    """
    sess = db.session(app_handle)
    try:
        db.set_default_tool_ids(sess, body.toolIds)
    finally:
        sess.close()
    
    return None


@commands.command()
async def get_auto_title_settings(app_handle: AppHandle) -> AutoTitleSettings:
    """
    Get auto-title generation settings.
    
    Returns:
        Auto-title settings including enabled, prompt, and model configuration
    """
    with db.db_session(app_handle) as sess:
        settings = db.get_auto_title_settings(sess)
    
    return AutoTitleSettings(
        enabled=settings.get("enabled", True),
        prompt=settings.get("prompt", "Generate a brief, descriptive title (max 6 words) for this conversation based on the user's message: {{ message }}\n\nReturn only the title, nothing else."),
        modelMode=settings.get("model_mode", "current"),
        provider=settings.get("provider", "openai"),
        modelId=settings.get("model_id", "gpt-4o-mini"),
    )


@commands.command()
async def save_auto_title_settings(body: SaveAutoTitleSettingsInput, app_handle: AppHandle) -> None:
    """
    Save auto-title generation settings.
    
    Args:
        body: Auto-title settings to save
        app_handle: Tauri app handle
    """
    with db.db_session(app_handle) as sess:
        settings = {
            "enabled": body.enabled,
            "prompt": body.prompt,
            "model_mode": body.modelMode,
            "provider": body.provider,
            "model_id": body.modelId,
        }
        db.save_auto_title_settings(sess, settings)
    
    return None


@commands.command()
async def get_model_settings(app_handle: AppHandle) -> AllModelSettingsResponse:
    """
    Get all model settings including reasoning capabilities.
    
    Returns:
        List of model settings with reasoning support flags
    """
    with db.db_session(app_handle) as sess:
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
                ) if thinking_tag_prompted else None,
            )
        )
    
    return AllModelSettingsResponse(models=result)


@commands.command()
async def save_model_settings(body: SaveModelSettingsInput, app_handle: AppHandle) -> None:
    """
    Save or update model settings (including reasoning support).
    
    Args:
        body: Model settings to save
        app_handle: Tauri app handle
    """
    with db.db_session(app_handle) as sess:
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


class RespondToThinkingTagPromptInput(_BaseModel):
    provider: str
    modelId: str
    accepted: bool


class ReprocessMessageRequest(_BaseModel):
    messageId: str


@commands.command()
async def reprocess_message_think_tags(
    body: ReprocessMessageRequest,
    app_handle: AppHandle
) -> dict:
    """
    Re-process a message to parse <think> tags from its content.
    Returns {success: bool}
    """
    from ..commands.streaming import reprocess_message_with_think_tags
    success = reprocess_message_with_think_tags(app_handle, body.messageId)
    return {"success": success}


@commands.command()
async def respond_to_thinking_tag_prompt(
    body: RespondToThinkingTagPromptInput, 
    app_handle: AppHandle
) -> None:
    """
    Handle user response to thinking tag detection prompt.
    
    If accepted, enables parse_think_tags and reprocesses the current message.
    If declined, stores thinkingTagPrompted: { prompted: true, declined: true } in extra.
    
    Args:
        body: User's response
        app_handle: Tauri app handle
    """
    with db.db_session(app_handle) as sess:
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
