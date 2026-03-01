from __future__ import annotations

import urllib.parse
import urllib.request


def is_http_url(value: str, *, require_netloc: bool = False) -> bool:
    raw = value.strip()
    if require_netloc:
        parsed = urllib.parse.urlparse(raw)
        return parsed.scheme in {"http", "https"} and bool(parsed.netloc)

    lowered = raw.lower()
    return lowered.startswith("http://") or lowered.startswith("https://")


def normalize_repo_url(value: str, *, require_netloc: bool = False) -> str:
    raw = value.strip()
    if not raw:
        raise ValueError("repoUrl is required")
    if not is_http_url(raw, require_netloc=require_netloc):
        raise ValueError("repoUrl must be an http(s) URL")
    if raw.endswith(".git"):
        raw = raw[:-4]
    return raw.rstrip("/")


def extract_github_owner_repo(
    repo_url: str,
    *,
    require_netloc: bool = False,
) -> tuple[str, str]:
    normalized = normalize_repo_url(repo_url, require_netloc=require_netloc)
    parsed = urllib.parse.urlparse(normalized)
    host = (parsed.netloc or "").strip().lower()
    if host != "github.com":
        raise ValueError("Only GitHub repositories are supported for repo installs")

    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) < 2:
        raise ValueError("repoUrl must include owner and repo")
    return parts[0], parts[1]


def download_github_archive(
    repo_url: str,
    ref: str,
    *,
    require_netloc: bool = False,
) -> bytes:
    owner, repo = extract_github_owner_repo(repo_url, require_netloc=require_netloc)
    safe_ref = (ref or "main").strip() or "main"
    archive_url = f"https://codeload.github.com/{owner}/{repo}/zip/refs/heads/{safe_ref}"

    try:
        with urllib.request.urlopen(archive_url, timeout=20) as response:
            return response.read()
    except Exception:
        fallback_url = f"https://codeload.github.com/{owner}/{repo}/zip/{safe_ref}"
        with urllib.request.urlopen(fallback_url, timeout=20) as response:
            return response.read()
