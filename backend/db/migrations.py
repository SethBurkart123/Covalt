from __future__ import annotations

#import sqlalchemy

from .core import _get_engine


def run_migrations() -> None:
    """Run database migrations for schema changes."""
    engine = _get_engine()
    if engine is None:
        return

    # implement migrations here