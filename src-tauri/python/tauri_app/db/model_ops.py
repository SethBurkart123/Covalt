from __future__ import annotations

from typing import List, Optional
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Model


def get_model_settings(sess: Session, provider: str, model_id: str) -> Optional[Model]:
    """Get settings for a specific model. Returns ORM object or None."""
    return sess.get(Model, {"provider": provider, "model_id": model_id})


def get_all_model_settings(sess: Session, provider: Optional[str] = None) -> List[Model]:
    """Get all model settings, optionally filtered by provider. Returns list of ORM objects."""
    stmt = select(Model)
    if provider:
        stmt = stmt.where(Model.provider == provider)
    
    return list(sess.scalars(stmt))


def _parse_extra(extra_raw: Optional[str]) -> dict:
    """Parse extra JSON string to dict."""
    if not extra_raw:
        return {}
    try:
        return json.loads(extra_raw)
    except (json.JSONDecodeError, TypeError):
        return {}


def _serialize_extra(extra_dict: dict) -> str:
    """Serialize dict to JSON string."""
    return json.dumps(extra_dict) if extra_dict else ""


def _get_reasoning_from_extra(extra_raw: Optional[str]) -> dict:
    """Extract reasoning object from extra JSON."""
    extra = _parse_extra(extra_raw)
    return extra.get("reasoning", {"supports": False, "isUserOverride": False})


def get_reasoning_from_model(model: Model) -> dict:
    """Extract reasoning object from Model ORM object."""
    return _get_reasoning_from_extra(model.extra)


def _update_extra_with_reasoning(extra_raw: Optional[str], reasoning: dict) -> str:
    """Update extra JSON with reasoning object."""
    extra = _parse_extra(extra_raw)
    extra["reasoning"] = reasoning
    return _serialize_extra(extra)


def save_model_settings(
    sess: Session,
    *,
    provider: str,
    model_id: str,
    parse_think_tags: bool = False,
    reasoning: Optional[dict] = None,
    extra: Optional[dict] = None,
) -> None:
    """
    Save or update model settings.
    
    Args:
        reasoning: Dict with 'supports' and 'isUserOverride' keys
        extra: Dict to merge into extra field (use None to skip updating extra)
    """
    model = sess.get(Model, {"provider": provider, "model_id": model_id})
    
    if model:
        model.parse_think_tags = parse_think_tags
        if reasoning is not None:
            model.extra = _update_extra_with_reasoning(model.extra, reasoning)
        if extra is not None:
            # Merge extra dict into existing extra
            existing_extra = _parse_extra(model.extra)
            existing_extra.update(extra)
            model.extra = _serialize_extra(existing_extra)
    else:
        extra_json = ""
        if reasoning is not None:
            extra_dict = {}
            extra_dict["reasoning"] = reasoning
            if extra is not None:
                extra_dict.update(extra)
            extra_json = _serialize_extra(extra_dict)
        elif extra is not None:
            extra_json = _serialize_extra(extra)
        
        model = Model(
            provider=provider,
            model_id=model_id,
            parse_think_tags=parse_think_tags,
            extra=extra_json if extra_json else None,
        )
        sess.add(model)
    
    sess.commit()


def upsert_model_settings(
    sess: Session,
    *,
    provider: str,
    model_id: str,
    parse_think_tags: bool = False,
    reasoning: Optional[dict] = None,
    extra: Optional[dict] = None,
) -> None:
    """
    Upsert model settings - only update if it's NOT a user override.
    This allows auto-detected data to be updated without clobbering user preferences.
    """
    model = sess.get(Model, {"provider": provider, "model_id": model_id})
    
    if model:
        current_reasoning = _get_reasoning_from_extra(model.extra)
        if current_reasoning.get("isUserOverride", False):
            # Don't touch user overrides
            return
    
    save_model_settings(
        sess,
        provider=provider,
        model_id=model_id,
        parse_think_tags=parse_think_tags,
        reasoning=reasoning,
        extra=extra,
    )

