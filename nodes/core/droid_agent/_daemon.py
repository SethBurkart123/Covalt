"""Shared helpers for talking to the local Factory droid daemon.

The daemon is the source of truth for both the available model list and the
user's configured defaults (model, reasoning, autonomy, interaction mode), so
we never re-parse `~/.factory/settings.json` ourselves. A short TTL cache keeps
options-loader latency low without holding state long enough to mask updates.
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_PROBE_TTL_SECONDS = 60.0


@dataclass
class DroidProbe:
    options: list[dict[str, Any]] = field(default_factory=list)
    default_model: str = ""
    default_reasoning: str = ""
    default_autonomy: str = ""
    default_interaction_mode: str = ""


_cache: dict[str, Any] = {"ts": 0.0, "probe": None}
_lock = asyncio.Lock()


def resolve_droid_executable() -> str | None:
    found = shutil.which("droid")
    if found:
        return found
    fallback = Path.home() / ".local" / "bin" / "droid"
    if fallback.exists():
        return str(fallback)
    return None


def _cache_fresh() -> DroidProbe | None:
    cached = _cache.get("probe")
    if not isinstance(cached, DroidProbe):
        return None
    age = time.monotonic() - float(_cache.get("ts") or 0.0)
    return cached if age < _PROBE_TTL_SECONDS else None


async def get_probe(*, force: bool = False) -> DroidProbe:
    if not force:
        fresh = _cache_fresh()
        if fresh is not None:
            return fresh

    async with _lock:
        if not force:
            fresh = _cache_fresh()
            if fresh is not None:
                return fresh

        droid_path = resolve_droid_executable()
        if droid_path is None:
            raise RuntimeError(
                "Droid CLI not found. Install with: curl -fsSL https://app.factory.ai/cli | sh"
            )

        probe = await _probe(droid_path)
        _cache["probe"] = probe
        _cache["ts"] = time.monotonic()
        return probe


async def _probe(droid_path: str) -> DroidProbe:
    from droid_sdk import DroidClient, ProcessTransport  # noqa: PLC0415

    transport = ProcessTransport(exec_path=droid_path, cwd=str(Path.home()))
    client = DroidClient(transport=transport)
    try:
        await client.connect()
        result = await client.initialize_session(
            machine_id="covalt-droid-probe",
            cwd=str(Path.home()),
        )
    finally:
        try:
            await client.close()
        except Exception:
            logger.debug("Failed to close droid probe client", exc_info=True)

    options = _models_to_options(getattr(result, "available_models", None) or [])
    settings = getattr(result, "settings", None)

    return DroidProbe(
        options=options,
        default_model=_enum_value(getattr(settings, "model_id", "") or ""),
        default_reasoning=_enum_value(getattr(settings, "reasoning_effort", None)),
        default_autonomy=_enum_value(getattr(settings, "autonomy_level", None)),
        default_interaction_mode=_enum_value(getattr(settings, "interaction_mode", None)),
    )


def _enum_value(value: Any) -> str:
    if value is None:
        return ""
    inner = getattr(value, "value", value)
    return str(inner) if inner is not None else ""


def _models_to_options(raw: list[Any]) -> list[dict[str, Any]]:
    options: list[dict[str, Any]] = []
    for entry in raw:
        model_id = getattr(entry, "id", None) or getattr(entry, "model_id", None)
        if not isinstance(model_id, str) or not model_id:
            continue
        label = (
            getattr(entry, "display_name", None)
            or getattr(entry, "short_display_name", None)
            or model_id
        )
        if model_id.startswith("custom:"):
            group = "Custom"
        else:
            provider_label = _enum_value(getattr(entry, "model_provider", None))
            group = _format_provider_label(provider_label) or "Other"
        options.append(
            {
                "value": model_id,
                "label": str(label),
                "group": group,
            }
        )
    options.sort(key=lambda opt: (_group_sort_key(opt.get("group")), str(opt.get("label") or "")))
    return options


def _group_sort_key(group: Any) -> tuple[int, str]:
    label = str(group or "")
    return (1 if label == "Custom" else 0, label)


def _format_provider_label(provider: str) -> str:
    cleaned = provider.replace("_", " ").replace("-", " ").strip()
    if not cleaned:
        return ""
    parts = cleaned.split()
    return " ".join(p.upper() if p.lower() in {"ai", "api"} else p.title() for p in parts)
