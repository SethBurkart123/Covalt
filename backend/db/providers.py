from __future__ import annotations

import json
from typing import Any, Dict, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import ProviderSettings


def get_provider_settings(sess: Session, provider: str) -> Optional[Dict[str, Any]]:
    settings: Optional[ProviderSettings] = sess.get(ProviderSettings, provider)
    if not settings:
        return None

    return {
        "provider": settings.provider,
        "api_key": settings.api_key,
        "base_url": settings.base_url,
        "extra": settings.extra,
        "enabled": settings.enabled,
    }


def get_all_provider_settings(sess: Session) -> Dict[str, Dict[str, Any]]:
    stmt = select(ProviderSettings)
    result = {}
    for row in sess.scalars(stmt):
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
    settings: Optional[ProviderSettings] = sess.get(ProviderSettings, provider)

    json_extra = None
    if extra is not None:
        json_extra = extra if isinstance(extra, str) else json.dumps(extra)

    if settings:
        if api_key is not None:
            settings.api_key = api_key
        if base_url is not None:
            settings.base_url = base_url
        if extra is not None:
            settings.extra = json_extra
        settings.enabled = enabled
    else:
        settings = ProviderSettings(
            provider=provider,
            api_key=api_key,
            base_url=base_url,
            extra=json_extra,
            enabled=enabled,
        )
        sess.add(settings)

    sess.commit()
