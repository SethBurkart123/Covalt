from __future__ import annotations

import json
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Model


def get_model_settings(sess: Session, provider: str, model_id: str) -> Optional[Model]:
    return sess.get(Model, {"provider": provider, "model_id": model_id})


def get_all_model_settings(
    sess: Session, provider: Optional[str] = None
) -> List[Model]:
    stmt = select(Model)
    if provider:
        stmt = stmt.where(Model.provider == provider)
    return list(sess.scalars(stmt))


def _parse_extra(extra_raw: Optional[str]) -> dict:
    if not extra_raw:
        return {}
    try:
        return json.loads(extra_raw)
    except (json.JSONDecodeError, TypeError):
        return {}


def _serialize_extra(extra_dict: dict) -> str:
    return json.dumps(extra_dict) if extra_dict else ""


def _get_reasoning_from_extra(extra_raw: Optional[str]) -> dict:
    extra = _parse_extra(extra_raw)
    return extra.get("reasoning", {"supports": False, "isUserOverride": False})


def get_reasoning_from_model(model: Model) -> dict:
    return _get_reasoning_from_extra(model.extra)


def _update_extra_with_reasoning(extra_raw: Optional[str], reasoning: dict) -> str:
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
    model = sess.get(Model, {"provider": provider, "model_id": model_id})

    if model:
        model.parse_think_tags = parse_think_tags
        if reasoning is not None:
            model.extra = _update_extra_with_reasoning(model.extra, reasoning)
        if extra is not None:
            existing_extra = _parse_extra(model.extra)
            existing_extra.update(extra)
            model.extra = _serialize_extra(existing_extra)
    else:
        extra_json = ""
        if reasoning is not None:
            extra_dict = {"reasoning": reasoning}
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
    model = sess.get(Model, {"provider": provider, "model_id": model_id})

    if model:
        current_reasoning = _get_reasoning_from_extra(model.extra)
        if current_reasoning.get("isUserOverride", False):
            return

    save_model_settings(
        sess,
        provider=provider,
        model_id=model_id,
        parse_think_tags=parse_think_tags,
        reasoning=reasoning,
        extra=extra,
    )
