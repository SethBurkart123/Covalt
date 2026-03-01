from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from .models import ProviderOAuthCredential
from ..crypto import decrypt, encrypt


def get_provider_oauth(sess: Session, provider: str) -> Optional[Dict[str, Any]]:
    row: Optional[ProviderOAuthCredential] = sess.get(ProviderOAuthCredential, provider)
    if not row:
        return None

    try:
        access_token = decrypt(row.access_token)
        refresh_token = decrypt(row.refresh_token) if row.refresh_token else None
    except Exception:
        return None

    extra = None
    if row.extra:
        try:
            extra = json.loads(row.extra)
        except Exception:
            extra = row.extra

    return {
        "provider": row.provider,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": row.token_type,
        "expires_at": row.expires_at,
        "extra": extra,
    }


def save_provider_oauth(
    sess: Session,
    *,
    provider: str,
    access_token: str,
    refresh_token: Optional[str] = None,
    token_type: Optional[str] = None,
    expires_at: Optional[str] = None,
    extra: Optional[Dict[str, Any] | str] = None,
) -> None:
    row: Optional[ProviderOAuthCredential] = sess.get(ProviderOAuthCredential, provider)

    extra_json = None
    if extra is not None:
        extra_json = extra if isinstance(extra, str) else json.dumps(extra)

    now = datetime.now().isoformat()
    if row:
        row.access_token = encrypt(access_token)
        row.refresh_token = encrypt(refresh_token) if refresh_token else None
        row.token_type = token_type
        row.expires_at = expires_at
        row.extra = extra_json
        row.updated_at = now
    else:
        sess.add(
            ProviderOAuthCredential(
                provider=provider,
                access_token=encrypt(access_token),
                refresh_token=encrypt(refresh_token) if refresh_token else None,
                token_type=token_type,
                expires_at=expires_at,
                extra=extra_json,
                created_at=now,
                updated_at=now,
            )
        )

    sess.commit()


def delete_provider_oauth(sess: Session, provider: str) -> None:
    row: Optional[ProviderOAuthCredential] = sess.get(ProviderOAuthCredential, provider)
    if not row:
        return
    sess.delete(row)
    sess.commit()
