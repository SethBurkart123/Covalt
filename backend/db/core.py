from __future__ import annotations

from pathlib import Path
from typing import Optional, Union
from contextlib import contextmanager

from pytauri import App, AppHandle, Manager
from pytauri.ffi.webview import WebviewWindow
from pytauri.path import PathResolver
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

from .models import Base


_engine = None
_Session = None
_db_path_override: Optional[Path] = None


def set_db_path(path: Path) -> None:
    global _db_path_override
    path.parent.mkdir(parents=True, exist_ok=True)
    _db_path_override = path


def get_db_path(app: Union[App, AppHandle, WebviewWindow]) -> Path:
    # Fallback if not set via init_database
    return _db_path_override or (get_resource_dir(app) / "app.db")


def get_resource_dir(manager: Union[App, AppHandle, WebviewWindow]) -> Path:
    path_resolver: PathResolver = Manager.path(manager)
    return path_resolver.resource_dir()


def _ensure_engine(app: Union[App, AppHandle, WebviewWindow]):
    global _engine, _Session
    if _engine is None:
        db_path = get_db_path(app)
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


def init_database(app: Union[App, AppHandle, WebviewWindow]) -> Path:
    """Ensure the database engine and schema exist. Returns DB path."""
    _ensure_engine(app)
    from .migrations import run_migrations
    run_migrations(app)
    return get_db_path(app)


def session(app: Union[App, AppHandle, WebviewWindow]) -> Session:
    _ensure_engine(app)
    assert _Session is not None
    return _Session()


@contextmanager
def db_session(app: Union[App, AppHandle, WebviewWindow]):
    """Context manager for database sessions - handles cleanup automatically."""
    sess = session(app)
    try:
        yield sess
    finally:
        sess.close()

