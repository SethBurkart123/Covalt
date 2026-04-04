from __future__ import annotations

from .core import _get_engine


def run_migrations() -> None:
    _get_engine()
