from __future__ import annotations

import os
from typing import Optional

from dotenv import load_dotenv

def load_env() -> None:
    load_dotenv()

def get_env(key: str, default: Optional[str] = None) -> Optional[str]:
    load_env()
    return os.getenv(key, default)


def require_env(key: str) -> str:
    value = get_env(key)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {key}")
    return value
