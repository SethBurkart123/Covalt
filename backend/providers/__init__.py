"""Provider auto-discovery. Each provider exports get_<provider>_model() and fetch_models()."""

from __future__ import annotations

import contextvars
import importlib
import inspect
import pkgutil
from typing import Any, Dict, List, Optional, Tuple

from .. import db
from .options import resolve_common_options

PROVIDERS: Dict[str, Dict[str, Any]] = {}
ALIASES: Dict[str, str] = {}

_credential_override: contextvars.ContextVar[
    Optional[Tuple[Optional[str], Optional[str]]]
] = contextvars.ContextVar("credential_override", default=None)


def _default_get_model_options(
    _model_id: str,
    _model_metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return {"main": [], "advanced": []}


def _default_resolve_options(
    _model_id: str,
    model_options: Dict[str, Any] | None,
    node_params: Dict[str, Any] | None,
) -> Dict[str, Any]:
    return resolve_common_options(model_options, node_params)


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
        model_options_func = getattr(module, "get_model_options", None)
        resolve_options_func = getattr(module, "resolve_options", None)
        if get_func and fetch_func:
            PROVIDERS[name] = {
                "get_model": get_func,
                "fetch_models": fetch_func,
                "test_connection": test_func,
                "get_model_options": model_options_func or _default_get_model_options,
                "resolve_options": resolve_options_func or _default_resolve_options,
            }

            if hasattr(module, "ALIASES"):
                for alias in module.ALIASES:
                    ALIASES[alias] = name

            print(f"✓ {name}")
        else:
            print(f"⚠ {name} missing required functions")

    except Exception as e:
        print(f"✗ {name}: {e}")


def get_model(
    provider: str,
    model_id: str,
    provider_options: Dict[str, Any] | None = None,
) -> Any:
    provider = _normalize(provider)
    if provider not in PROVIDERS:
        raise ValueError(
            f"Unknown provider '{provider}'. Available: {', '.join(PROVIDERS.keys())}"
        )
    options = provider_options or {}
    return PROVIDERS[provider]["get_model"](model_id, provider_options=options)


async def fetch_provider_models(provider: str) -> List[Dict[str, Any]]:
    provider = _normalize(provider)
    if provider not in PROVIDERS:
        return []
    return await PROVIDERS[provider]["fetch_models"]()


def get_provider_model_options(
    provider: str,
    model_id: str,
    model_metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    provider = _normalize(provider)
    if provider not in PROVIDERS:
        return _default_get_model_options(model_id, model_metadata)
    return PROVIDERS[provider]["get_model_options"](model_id, model_metadata)


def resolve_provider_options(
    provider: str,
    model_id: str,
    model_options: Dict[str, Any] | None,
    node_params: Dict[str, Any] | None,
) -> Dict[str, Any]:
    provider = _normalize(provider)
    if provider not in PROVIDERS:
        return _default_resolve_options(model_id, model_options, node_params)
    return PROVIDERS[provider]["resolve_options"](model_id, model_options, node_params)


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
    "get_provider_model_options",
    "test_provider_connection",
    "list_providers",
    "resolve_provider_options",
    "get_credentials",
    "get_api_key",
    "get_base_url",
    "get_extra_config",
]
