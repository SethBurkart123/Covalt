from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from typing import Optional

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from ..config import get_db_path as _get_db_path
from .models import Base

_engine = None
_Session = None
_db_path_override: Optional[Path] = None


def set_db_path(path: Path) -> None:
    global _db_path_override
    path.parent.mkdir(parents=True, exist_ok=True)
    _db_path_override = path


def get_db_path() -> Path:
    return _db_path_override or _get_db_path()


def _ensure_engine():
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
    return _engine


def init_database() -> Path:
    _ensure_engine()
    from .migrations import run_migrations

    run_migrations()
    return get_db_path()


def session() -> Session:
    _ensure_engine()
    assert _Session is not None
    return _Session()


@contextmanager
def db_session():
    sess = session()
    try:
        yield sess
    finally:
        sess.close()
