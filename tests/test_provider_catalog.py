from __future__ import annotations

from types import SimpleNamespace

from backend.services import provider_catalog


def test_list_provider_catalog_includes_plugin_provider(monkeypatch) -> None:
    monkeypatch.setattr(
        provider_catalog,
        "PROVIDERS",
        {
            "openai": {},
            "sample_code_provider": {},
        },
    )

    fake_manager = SimpleNamespace(
        list_plugins=lambda: [
            SimpleNamespace(
                id="sample_code_provider",
                name="Sample Code Provider",
                version="0.1.0",
                provider="sample_code_provider",
                installed_at="now",
                source_type="local",
                source_ref="examples",
                description="Sample",
                icon="openai",
                auth_type="apiKey",
                default_base_url=None,
                oauth_variant=None,
                oauth_enterprise_domain=False,
                aliases=["sample-code"],
                error=None,
            )
        ],
    )
    monkeypatch.setattr(provider_catalog, "get_provider_plugin_manager", lambda: fake_manager)

    entries = provider_catalog.list_provider_catalog()
    by_provider = {entry.provider: entry for entry in entries}

    assert "sample_code_provider" in by_provider


def test_list_provider_catalog_exposes_field_mode_from_manifest(monkeypatch) -> None:
    monkeypatch.setattr(
        provider_catalog,
        "PROVIDERS",
        {
            "openai_like": {},
            "ollama": {},
            "vllm": {},
            "openai": {},
            "openai_codex": {},
            "github_copilot": {},
        },
    )

    monkeypatch.setattr(
        provider_catalog,
        "MANIFEST_PROVIDERS",
        [
            {"id": "openai_like", "adapter": "openai_compatible"},
            {"id": "ollama", "adapter": "openai_compatible"},
            {"id": "vllm", "adapter": "openai_compatible"},
        ],
    )

    fake_manager = SimpleNamespace(list_plugins=lambda: [])
    monkeypatch.setattr(provider_catalog, "get_provider_plugin_manager", lambda: fake_manager)

    entries = provider_catalog.list_provider_catalog()
    by_provider = {entry.provider: entry for entry in entries}

    assert by_provider["openai_like"].field_mode == "openai_compatible"
    assert by_provider["ollama"].field_mode == "local_ollama"
    assert by_provider["vllm"].field_mode == "local_vllm"
    assert by_provider["openai"].field_mode == "standard_api_key"


def test_list_provider_catalog_excludes_claude_and_gemini_oauth_by_default(monkeypatch) -> None:
    monkeypatch.setattr(
        provider_catalog,
        "PROVIDERS",
        {
            "openai": {},
            "openai_codex": {},
            "github_copilot": {},
        },
    )
    monkeypatch.setattr(provider_catalog, "MANIFEST_PROVIDERS", [])

    fake_manager = SimpleNamespace(list_plugins=lambda: [])
    monkeypatch.setattr(provider_catalog, "get_provider_plugin_manager", lambda: fake_manager)

    entries = provider_catalog.list_provider_catalog()
    by_provider = {entry.provider: entry for entry in entries}

    assert "openai_codex" in by_provider
    assert "github_copilot" in by_provider
    assert "anthropic_oauth" not in by_provider
    assert "google_gemini_cli" not in by_provider
