from __future__ import annotations

from .core import _get_engine


def run_migrations() -> None:
    engine = _get_engine()
    if engine is None:
        return
