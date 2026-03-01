"""Provider registry and runtime loader."""

from __future__ import annotations

import contextvars
import importlib
import inspect
import pkgutil
import sys
import types
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .. import db
from ..services.provider_plugin_manager import get_provider_plugin_manager
from ._manifest import MANIFEST_PROVIDERS
from .adapters import ADAPTER_REGISTRY
from .options import resolve_common_options

PROVIDERS: Dict[str, Dict[str, Any]] = {}
ALIASES: Dict[str, str] = {}
_MANIFEST_PROVIDER_IDS = {
    str(item.get("id") or "").lower().strip().replace("-", "_")
    for item in MANIFEST_PROVIDERS
    if isinstance(item, dict) and item.get("id")
}

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


def _normalize_provider_key(value: str) -> str:
    return value.lower().strip().replace("-", "_")


def _register_provider(
    provider_id: str,
    entry: Dict[str, Any],
    *,
    aliases: list[str] | None = None,
) -> None:
    normalized_provider = _normalize_provider_key(provider_id)
    entry.setdefault("get_model_options", _default_get_model_options)
    entry.setdefault("resolve_options", _default_resolve_options)
    PROVIDERS[normalized_provider] = entry
    for alias in aliases or []:
        normalized_alias = _normalize_provider_key(alias)
        if normalized_alias and normalized_alias != normalized_provider:
            ALIASES[normalized_alias] = normalized_provider


def get_credentials(
    provider_name: str | None = None,
) -> Tuple[Optional[str], Optional[str]]:
    """Get API credentials for a provider.

    If *provider_name* is given it is used directly; otherwise the provider is
    auto-detected from the caller's filename (legacy behaviour).
    """
    override = _credential_override.get()
    if override is not None:
        return override

    provider = provider_name or _get_caller_provider()

    with db.db_session() as sess:
        settings = db.get_provider_settings(sess, provider)
        if settings:
            return settings.get("api_key"), settings.get("base_url")

    return None, None


def get_api_key(provider_name: str | None = None) -> Optional[str]:
    return get_credentials(provider_name)[0]


def get_base_url(provider_name: str | None = None) -> Optional[str]:
    return get_credentials(provider_name)[1]


def get_extra_config(provider_name: str | None = None) -> dict:
    import json

    provider = provider_name or _get_caller_provider()

    with db.db_session() as sess:
        settings = db.get_provider_settings(sess, provider)
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


def _load_python_module_providers() -> None:
    for _, name, _ in pkgutil.iter_modules(__path__):
        if name.startswith("_") or name == "adapters":
            continue

        normalized_name = _normalize_provider_key(name)
        if normalized_name in _MANIFEST_PROVIDER_IDS:
            continue
        try:
            module = importlib.import_module(f".{name}", __package__)
            get_func = getattr(module, f"get_{name}_model", None)
            fetch_func = getattr(module, "fetch_models", None)
            test_func = getattr(module, "test_connection", None)
            model_options_func = getattr(module, "get_model_options", None)
            resolve_options_func = getattr(module, "resolve_options", None)

            if not get_func or not fetch_func:
                print(f"⚠ {name} missing required functions")
                continue

            _register_provider(
                name,
                {
                    "get_model": get_func,
                    "fetch_models": fetch_func,
                    "test_connection": test_func,
                    "get_model_options": model_options_func
                    or _default_get_model_options,
                    "resolve_options": resolve_options_func
                    or _default_resolve_options,
                },
                aliases=list(getattr(module, "ALIASES", []) or []),
            )
            print(f"✓ {name}")
        except Exception as e:
            print(f"✗ {name}: {e}")


def _load_manifest_providers() -> None:
    import backend.providers.adapters.anthropic_compatible  # noqa: F401
    import backend.providers.adapters.openai_compatible  # noqa: F401

    for cfg in MANIFEST_PROVIDERS:
        cfg_dict = dict(cfg)
        provider_id = str(cfg_dict.pop("id"))
        adapter_name = str(cfg_dict.pop("adapter"))
        aliases = cfg_dict.pop("aliases", [])
        normalized_provider = _normalize_provider_key(provider_id)
        if normalized_provider in PROVIDERS:
            continue

        create = ADAPTER_REGISTRY.get(adapter_name)
        if create is None:
            print(f"✗ {provider_id}: unknown adapter '{adapter_name}'")
            continue

        try:
            entry = create(provider_id=normalized_provider, **cfg_dict)
            _register_provider(normalized_provider, entry, aliases=list(aliases or []))
            print(f"✓ {provider_id}")
        except Exception as e:
            print(f"✗ {provider_id}: {e}")


def _load_plugin_module(plugin_id: str, plugin_dir: Path, module_name: str) -> Any:
    safe_plugin = plugin_id.replace("-", "_")
    root_package = f"_covalt_provider_plugin_{safe_plugin}"

    if root_package not in sys.modules:
        package_module = types.ModuleType(root_package)
        package_module.__path__ = [str(plugin_dir)]
        sys.modules[root_package] = package_module

    full_module_name = f"{root_package}.{module_name}"
    if full_module_name in sys.modules:
        del sys.modules[full_module_name]

    return importlib.import_module(full_module_name)


def _invoke_provider_factory(factory: Any, *, provider_id: str, manifest: dict[str, Any], plugin_dir: str) -> Any:
    if not callable(factory):
        raise ValueError("Provider plugin factory is not callable")

    kwargs: dict[str, Any] = {
        "provider_id": provider_id,
        "manifest": manifest,
        "plugin_dir": plugin_dir,
    }

    signature = inspect.signature(factory)
    accepts_var_kwargs = any(
        param.kind == inspect.Parameter.VAR_KEYWORD
        for param in signature.parameters.values()
    )
    accepted_kwargs = {
        key: value
        for key, value in kwargs.items()
        if accepts_var_kwargs or key in signature.parameters
    }

    if accepted_kwargs:
        return factory(**accepted_kwargs)
    return factory()


def _load_plugin_entry(manifest: Any) -> Dict[str, Any]:
    if manifest.entrypoint:
        module_name, factory_name = manifest.entrypoint.rsplit(":", 1)
        module = _load_plugin_module(
            manifest.id,
            manifest.path.parent,
            module_name.strip(),
        )
        factory = getattr(module, factory_name.strip(), None)
        if factory is None:
            raise ValueError(
                f"Provider plugin entrypoint function not found: {manifest.entrypoint}"
            )
        entry = _invoke_provider_factory(
            factory,
            provider_id=manifest.provider,
            manifest=manifest.raw,
            plugin_dir=str(manifest.path.parent),
        )
    else:
        adapter_name = str(manifest.adapter or "").strip()
        create = ADAPTER_REGISTRY.get(adapter_name)
        if create is None:
            raise ValueError(f"Unknown adapter '{adapter_name}'")
        entry = create(provider_id=manifest.provider, **manifest.adapter_config)

    if not isinstance(entry, dict):
        raise ValueError("Provider plugin entrypoint must return a provider entry object")
    if not callable(entry.get("get_model")):
        raise ValueError("Provider plugin entry missing callable get_model")
    if not callable(entry.get("fetch_models")):
        raise ValueError("Provider plugin entry missing callable fetch_models")

    return entry


def _load_plugin_providers() -> None:
    manager = get_provider_plugin_manager()
    for manifest in manager.get_enabled_manifests():
        normalized_provider = _normalize_provider_key(manifest.provider)
        if normalized_provider in PROVIDERS:
            print(
                f"✗ plugin:{manifest.id}: provider '{normalized_provider}' already exists"
            )
            continue

        try:
            entry = _load_plugin_entry(manifest)
            _register_provider(
                normalized_provider,
                entry,
                aliases=list(manifest.aliases or []),
            )
            print(f"✓ plugin:{manifest.id}")
        except Exception as e:
            print(f"✗ plugin:{manifest.id}: {e}")


def reload_provider_registry() -> None:
    PROVIDERS.clear()
    ALIASES.clear()
    _load_python_module_providers()
    _load_manifest_providers()
    _load_plugin_providers()


reload_provider_registry()


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
    provider = _normalize_provider_key(provider)
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
    "reload_provider_registry",
]
