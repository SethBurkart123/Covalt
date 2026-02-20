"""Provider auto-discovery. Each provider exports get_<provider>_model() and fetch_models()."""

from __future__ import annotations

import contextvars
import importlib
import inspect
import pkgutil
from typing import Any, Dict, List, Optional, Tuple

from .. import db

PROVIDERS: Dict[str, Dict[str, Any]] = {}
ALIASES: Dict[str, str] = {}

_credential_override: contextvars.ContextVar[
    Optional[Tuple[Optional[str], Optional[str]]]
] = contextvars.ContextVar("credential_override", default=None)


def get_credentials() -> Tuple[Optional[str], Optional[str]]:
    """Get API credentials for the calling provider. Auto-detects provider from filename."""
    override = _credential_override.get()
    if override is not None:
        return override

    provider = _get_caller_provider()

    with db.db_session() as sess:
        settings = db.get_provider_settings(sess, provider)
        if settings:
            return settings.get("api_key"), settings.get("base_url")

    return None, None


def get_api_key() -> Optional[str]:
    return get_credentials()[0]


def get_base_url() -> Optional[str]:
    return get_credentials()[1]


def get_extra_config() -> dict:
    import json

    with db.db_session() as sess:
        settings = db.get_provider_settings(sess, _get_caller_provider())
        if settings and settings.get("extra"):
            extra = settings["extra"]
            return json.loads(extra) if isinstance(extra, str) else extra

    return {}


def _get_caller_provider() -> str:
    frame = inspect.currentframe()

    while frame:
        frame = frame.f_back
        if frame and "__file__" in frame.f_globals:
            filename = frame.f_globals["__file__"].replace("\\", "/")
            if "providers/" in filename and filename.endswith(".py"):
                provider = filename.split("/")[-1].replace(".py", "")
                if provider != "__init__":
                    return provider

    raise RuntimeError("Could not detect provider name from caller")


for _, name, _ in pkgutil.iter_modules(__path__):
    try:
        module = importlib.import_module(f".{name}", __package__)
        get_func = getattr(module, f"get_{name}_model", None)
        fetch_func = getattr(module, "fetch_models", None)
        test_func = getattr(module, "test_connection", None)

        if get_func and fetch_func:
            PROVIDERS[name] = {
                "get_model": get_func,
                "fetch_models": fetch_func,
                "test_connection": test_func,
            }

            if hasattr(module, "ALIASES"):
                for alias in module.ALIASES:
                    ALIASES[alias] = name

            print(f"✓ {name}")
        else:
            print(f"⚠ {name} missing required functions")

    except Exception as e:
        print(f"✗ {name}: {e}")


def get_model(provider: str, model_id: str, **kwargs: Any) -> Any:
    provider = _normalize(provider)
    if provider not in PROVIDERS:
        raise ValueError(
            f"Unknown provider '{provider}'. Available: {', '.join(PROVIDERS.keys())}"
        )
    return PROVIDERS[provider]["get_model"](model_id, **kwargs)


async def fetch_provider_models(provider: str) -> List[Dict[str, Any]]:
    provider = _normalize(provider)
    if provider not in PROVIDERS:
        return []
    return await PROVIDERS[provider]["fetch_models"]()


def list_providers() -> List[str]:
    return list(PROVIDERS.keys())


def _normalize(provider: str) -> str:
    provider = provider.lower().strip().replace("-", "_")
    return ALIASES.get(provider, provider)


async def test_provider_connection(
    provider: str,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
) -> tuple[bool, str | None]:
    provider = _normalize(provider)

    if provider not in PROVIDERS:
        return False, f"Unknown provider '{provider}'"

    test_func = PROVIDERS[provider].get("test_connection")
    if not test_func:
        return False, "Provider does not support connection testing"

    if api_key is not None or base_url is not None:
        token = _credential_override.set((api_key, base_url))
        try:
            return await test_func()
        finally:
            _credential_override.reset(token)

    return await test_func()


__all__ = [
    "get_model",
    "fetch_provider_models",
    "test_provider_connection",
    "list_providers",
    "get_credentials",
    "get_api_key",
    "get_base_url",
    "get_extra_config",
]
