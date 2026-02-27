from __future__ import annotations

from types import SimpleNamespace

from backend.services import provider_catalog


def test_list_provider_catalog_includes_disabled_plugin_provider(monkeypatch) -> None:
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
                enabled=False,
                installed_at="now",
                source_type="local",
                source_ref="examples",
                description="Sample",
                icon="openai",
                auth_type="apiKey",
                default_base_url=None,
                default_enabled=False,
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
    assert by_provider["sample_code_provider"].default_enabled is False
