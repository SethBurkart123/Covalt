import os
from pathlib import Path


def get_db_directory() -> Path:
    # USER_DATA_DIR is set by the Electrobun main process (Utils.paths.userData)
    # and resolves to the app-scoped data directory, e.g.:
    #   macOS: ~/Library/Application Support/com.agno.desktop/<channel>
    app_data = os.getenv("USER_DATA_DIR")
    if app_data:
        db_dir = Path(app_data)
    elif os.getenv("ENV") != "production":
        db_dir = Path(__file__).parent.parent / "db"
    else:
        db_dir = Path.home() / ".agno"

    db_dir.mkdir(parents=True, exist_ok=True)
    return db_dir


def get_db_path() -> Path:
    return get_db_directory() / "app.db"


def get_pending_uploads_directory() -> Path:
    pending_dir = get_db_directory() / "pending_uploads"
    pending_dir.mkdir(parents=True, exist_ok=True)
    return pending_dir
