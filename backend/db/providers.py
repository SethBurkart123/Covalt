from __future__ import annotations

import json
from typing import Any, Dict, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import ProviderSettings


def normalize_provider(provider: str) -> str:
    return provider.lower().strip().replace("-", "_")


def _legacy_provider_key(provider: str) -> str:
    return provider.replace("_", "-")


def _to_record(settings: ProviderSettings, provider_key: str) -> Dict[str, Any]:
    return {
        "provider": provider_key,
        "api_key": settings.api_key,
        "base_url": settings.base_url,
        "extra": settings.extra,
        "enabled": settings.enabled,
    }


def get_provider_settings(sess: Session, provider: str) -> Optional[Dict[str, Any]]:
    canonical = normalize_provider(provider)
    settings: Optional[ProviderSettings] = sess.get(ProviderSettings, canonical)
    if settings:
        return _to_record(settings, canonical)

    legacy = _legacy_provider_key(canonical)
    if legacy != canonical:
        settings = sess.get(ProviderSettings, legacy)
        if settings:
            return _to_record(settings, canonical)

    return None


def get_all_provider_settings(sess: Session) -> Dict[str, Dict[str, Any]]:
    stmt = select(ProviderSettings)
    result: Dict[str, Dict[str, Any]] = {}
    for row in sess.scalars(stmt):
        canonical = normalize_provider(row.provider)
        if canonical in result and row.provider != canonical:
            continue
        result[canonical] = _to_record(row, canonical)
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
    canonical = normalize_provider(provider)
    settings: Optional[ProviderSettings] = sess.get(ProviderSettings, canonical)

    if not settings:
        legacy = _legacy_provider_key(canonical)
        if legacy != canonical:
            settings = sess.get(ProviderSettings, legacy)

    json_extra = None
    if extra is not None:
        json_extra = extra if isinstance(extra, str) else json.dumps(extra)

    if settings:
        if settings.provider != canonical:
            settings.provider = canonical
        if api_key is not None:
            settings.api_key = api_key
        if base_url is not None:
            settings.base_url = base_url
        if extra is not None:
            settings.extra = json_extra
        settings.enabled = enabled
    else:
        settings = ProviderSettings(
            provider=canonical,
            api_key=api_key,
            base_url=base_url,
            extra=json_extra,
            enabled=enabled,
        )
        sess.add(settings)

    sess.commit()
