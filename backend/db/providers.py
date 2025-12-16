from __future__ import annotations

import json
from typing import Any, Dict, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import ProviderSettings


def get_provider_settings(sess: Session, provider: str) -> Optional[Dict[str, Any]]:
    """
    Get settings for a specific provider.

    Args:
        sess: Database session
        provider: Provider name (openai, anthropic, groq, ollama)

    Returns:
        Provider settings dict or None if not found
    """
    settings: Optional[ProviderSettings] = sess.get(ProviderSettings, provider)
    if not settings:
        return None

    return {
        "provider": settings.provider,
        "api_key": settings.api_key,
        "base_url": settings.base_url,
        "extra": settings.extra,  # raw JSON string (UI handles editing)
        "enabled": settings.enabled,
    }


def get_all_provider_settings(sess: Session) -> Dict[str, Dict[str, Any]]:
    """
    Get all provider settings.

    Args:
        sess: Database session

    Returns:
        Dict mapping provider name to settings dict
    """
    stmt = select(ProviderSettings)
    rows = list(sess.scalars(stmt))

    result = {}
    for row in rows:
        result[row.provider] = {
            "provider": row.provider,
            "api_key": row.api_key,
            "base_url": row.base_url,
            "extra": row.extra,
            "enabled": row.enabled,
        }
    return result


def save_provider_settings(
    sess: Session,
    *,
    provider: str,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    extra: Optional[Dict[str, Any] | str] = None,
    enabled: bool = True,
) -> None:
    """
    Save or update provider settings.

    Args:
        sess: Database session
        provider: Provider name (openai, anthropic, groq, ollama)
        api_key: API key for the provider
        base_url: Base URL for the provider (optional, for custom endpoints)
        extra: Extra configuration for the provider (optional, for custom endpoints)
        enabled: Whether the provider is enabled
    """
    settings: Optional[ProviderSettings] = sess.get(ProviderSettings, provider)

    if settings:
        # Update existing
        if api_key is not None:
            settings.api_key = api_key
        if base_url is not None:
            settings.base_url = base_url
        if extra is not None:
            # Accept dict or string; store as JSON string
            if isinstance(extra, str):
                settings.extra = extra
            else:
                try:
                    settings.extra = json.dumps(extra)
                except Exception:
                    settings.extra = None
        settings.enabled = enabled
    else:
        # Create new
        json_extra = None
        if extra is not None:
            if isinstance(extra, str):
                json_extra = extra
            else:
                try:
                    json_extra = json.dumps(extra)
                except Exception:
                    json_extra = None
        settings = ProviderSettings(
            provider=provider,
            api_key=api_key,
            base_url=base_url,
            extra=json_extra,
            enabled=enabled,
        )
        sess.add(settings)

    sess.commit()
