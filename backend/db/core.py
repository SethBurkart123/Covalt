from __future__ import annotations

from pathlib import Path
from typing import Optional
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

from .models import Base
from ..config import get_db_path as _get_db_path

_engine = None
_Session = None
_db_path_override: Optional[Path] = None


def set_db_path(path: Path) -> None:
    """Override default database path."""
    global _db_path_override
    path.parent.mkdir(parents=True, exist_ok=True)
    _db_path_override = path


def get_db_path() -> Path:
    """Get current database path."""
    return _db_path_override or _get_db_path()


def _ensure_engine():
    """Initialize database engine if not already created."""
    global _engine, _Session
    if _engine is None:
        db_path = get_db_path()
        db_path.parent.mkdir(parents=True, exist_ok=True)
        _engine = create_engine(
            f"sqlite:///{db_path}",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(_engine)
        _Session = sessionmaker(bind=_engine, expire_on_commit=False)


def _get_engine():
    """Get the database engine (internal use for migrations)."""
    return _engine


def init_database() -> Path:
    """Ensure the database engine and schema exist. Returns DB path."""
    _ensure_engine()
    from .migrations import run_migrations
    run_migrations()
    return get_db_path()


def session() -> Session:
    """Create a new database session."""
    _ensure_engine()
    assert _Session is not None
    return _Session()


@contextmanager
def db_session():
    """Context manager for database sessions - handles cleanup automatically."""
    sess = session()
    try:
        yield sess
    finally:
        sess.close()

