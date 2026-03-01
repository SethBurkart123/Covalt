from __future__ import annotations

import os
from cryptography.fernet import Fernet

_fernet: Fernet | None = None


def get_fernet() -> Fernet:
    global _fernet
    if _fernet is not None:
        return _fernet

    key_env = os.environ.get("COVALT_ENCRYPTION_KEY")
    if key_env:
        _fernet = Fernet(key_env.encode())
        return _fernet

    key_file = os.path.expanduser("~/.covalt/encryption.key")
    os.makedirs(os.path.dirname(key_file), exist_ok=True)

    if os.path.exists(key_file):
        with open(key_file, "rb") as f:
            _fernet = Fernet(f.read())
            return _fernet

    key = Fernet.generate_key()
    with open(key_file, "wb") as f:
        f.write(key)
    os.chmod(key_file, 0o600)

    _fernet = Fernet(key)
    return _fernet


def encrypt(data: str) -> str:
    return get_fernet().encrypt(data.encode()).decode()


def decrypt(data: str) -> str:
    return get_fernet().decrypt(data.encode()).decode()
