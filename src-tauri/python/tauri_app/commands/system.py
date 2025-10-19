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
)
from ..services.model_factory import get_available_models as get_models_from_factory
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
    
    Checks both environment variables and database provider settings.
    
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
        settings = db.get_all_provider_settings(sess)
    finally:
        sess.close()
    
    providers = [
        ProviderConfig(
            provider=provider,
            api_key=config.get("api_key"),
            base_url=config.get("base_url"),
            enabled=config.get("enabled", True),
        )
        for provider, config in settings.items()
    ]
    
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
            enabled=body.enabled,
        )
    finally:
        sess.close()
    
    return None

