import os
from pathlib import Path


def get_db_directory() -> Path:
    if os.getenv("ENV") != "production":
        db_dir = Path(__file__).parent.parent / "db"
    else:
        app_data = os.getenv("ELECTRON_USER_DATA")
        db_dir = Path(app_data) / "agno" if app_data else Path.home() / ".agno"

    db_dir.mkdir(parents=True, exist_ok=True)
    return db_dir


def get_db_path() -> Path:
    return get_db_directory() / "app.db"


def get_pending_uploads_directory() -> Path:
    pending_dir = get_db_directory() / "pending_uploads"
    pending_dir.mkdir(parents=True, exist_ok=True)
    return pending_dir
