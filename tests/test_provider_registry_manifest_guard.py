from __future__ import annotations

import types

import backend.providers as providers


def test_manifest_migrated_anthropic_ids_use_adapter_entries() -> None:
    for provider_id in [
        "google_vertex_anthropic",
        "kimi_for_coding",
        "minimax",
        "minimax_coding_plan",
        "minimax_cn",
        "minimax_cn_coding_plan",
        "zenmux",
    ]:
        assert provider_id in providers.PROVIDERS
        assert (
            providers.PROVIDERS[provider_id]["get_model"].__module__
            == "backend.providers.adapters.anthropic_compatible"
        )


def test_load_python_module_providers_skips_manifest_ids(monkeypatch) -> None:
    original_providers = dict(providers.PROVIDERS)
    original_aliases = dict(providers.ALIASES)

    providers.PROVIDERS.clear()
    providers.ALIASES.clear()

    monkeypatch.setattr(providers, "_MANIFEST_PROVIDER_IDS", {"minimax"})

    def fake_iter_modules(_path):
        return [
            (None, "minimax", False),
            (None, "legacy_custom", False),
        ]

    monkeypatch.setattr(providers.pkgutil, "iter_modules", fake_iter_modules)

    def get_legacy_custom_model(model_id, provider_options):
        return {"id": model_id, "options": provider_options}

    async def fetch_models():
        return []

    fake_module = types.SimpleNamespace(
        get_legacy_custom_model=get_legacy_custom_model,
        fetch_models=fetch_models,
        ALIASES=["legacy-custom-alias"],
    )

    imported: list[str] = []

    def fake_import_module(name: str, package: str | None = None):
        imported.append(name)
        if name == ".minimax":
            raise AssertionError("Manifest-backed legacy module should not be imported")
        if name == ".legacy_custom":
            return fake_module
        raise ModuleNotFoundError(name)

    monkeypatch.setattr(providers.importlib, "import_module", fake_import_module)

    try:
        providers._load_python_module_providers()
        assert ".minimax" not in imported
        assert ".legacy_custom" in imported
        assert "legacy_custom" in providers.PROVIDERS
        assert providers.ALIASES["legacy_custom_alias"] == "legacy_custom"
    finally:
        providers.PROVIDERS.clear()
        providers.PROVIDERS.update(original_providers)
        providers.ALIASES.clear()
        providers.ALIASES.update(original_aliases)
