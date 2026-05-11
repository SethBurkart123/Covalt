import os
from pathlib import Path


def _resolve_main_worktree_root(repo_root: Path) -> Path:
    git_entry = repo_root / ".git"
    if git_entry.is_dir():
        return repo_root
    if not git_entry.is_file():
        return repo_root

    try:
        content = git_entry.read_text(encoding="utf-8").strip()
    except OSError:
        return repo_root

    if not content.startswith("gitdir:"):
        return repo_root

    gitdir_raw = content.removeprefix("gitdir:").strip()
    if not gitdir_raw:
        return repo_root

    gitdir_path = Path(gitdir_raw)
    if not gitdir_path.is_absolute():
        gitdir_path = (repo_root / gitdir_path).resolve()

    # Linked worktrees point at <main>/.git/worktrees/<worktree-id>.
    parts = gitdir_path.parts
    if "worktrees" not in parts:
        return repo_root

    idx = len(parts) - 1 - list(reversed(parts)).index("worktrees")
    common_git_dir = Path(*parts[:idx])
    if common_git_dir.name != ".git":
        return repo_root

    return common_git_dir.parent


def get_db_directory() -> Path:
    # USER_DATA_DIR is set by the Electrobun main process (Utils.paths.userData)
    # and resolves to the app-scoped data directory, e.g.:
    #   macOS: ~/Library/Application Support/com.covalt.desktop/<channel>
    app_data = os.getenv("USER_DATA_DIR")
    if app_data:
        db_dir = Path(app_data)
    elif os.getenv("ENV") != "production":
        repo_root = Path(__file__).resolve().parent.parent
        db_dir = _resolve_main_worktree_root(repo_root) / "db"
    else:
        db_dir = Path.home() / ".covalt"

    db_dir.mkdir(parents=True, exist_ok=True)
    return db_dir


def get_db_path() -> Path:
    return get_db_directory() / "app.db"


def get_pending_uploads_directory() -> Path:
    pending_dir = get_db_directory() / "pending_uploads"
    pending_dir.mkdir(parents=True, exist_ok=True)
    return pending_dir
