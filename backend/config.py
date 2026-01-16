import os
from pathlib import Path


def get_db_directory() -> Path:
    """Get database directory based on environment."""
    if os.getenv("ENV") != "production":
        db_dir = Path(__file__).parent.parent / "db"
    else:
        app_data = os.getenv("ELECTRON_USER_DATA")
        if app_data:
            db_dir = Path(app_data) / "agno"
        else:
            db_dir = Path.home() / ".agno"

    db_dir.mkdir(parents=True, exist_ok=True)
    return db_dir


def get_db_path() -> Path:
    """Get full path to database file."""
    return get_db_directory() / "app.db"


def get_pending_uploads_directory() -> Path:
    """Get directory for pending uploads (before they're added to workspace)."""
    pending_dir = get_db_directory() / "pending_uploads"
    pending_dir.mkdir(parents=True, exist_ok=True)
    return pending_dir
