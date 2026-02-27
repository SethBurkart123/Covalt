from __future__ import annotations

import base64
from pathlib import Path

from cryptography.exceptions import InvalidSignature

from backend.services import provider_plugin_manager as ppm


def _write_code_plugin(
    source_dir: Path,
    *,
    signature: str | None = None,
    signing_key_id: str | None = None,
    signature_algorithm: str | None = None,
) -> None:
    manifest_lines = [
        "manifest_version: '1'",
        "id: community-echo",
        "name: Community Echo",
        "version: 0.1.0",
        "provider: community_echo",
        "entrypoint: plugin:create_provider",
        "aliases:",
        "  - community-echo",
        "description: Community Echo provider",
        "icon: openai",
        "default_enabled: true",
    ]

    if signature is not None:
        manifest_lines.append(f"signature: {signature}")
    if signing_key_id is not None:
        manifest_lines.append(f"signing_key_id: {signing_key_id}")
    if signature_algorithm is not None:
        manifest_lines.append(f"signature_algorithm: {signature_algorithm}")

    (source_dir / "provider.yaml").write_text("\n".join(manifest_lines))
    (source_dir / "plugin.py").write_text(
        "\n".join(
            [
                "from __future__ import annotations",
                "",
                "def create_provider(provider_id, **_kwargs):",
                "    async def fetch_models():",
                "        return [{'id': 'echo-model', 'name': 'Echo Model'}]",
                "",
                "    def get_model(model_id, provider_options=None):",
                "        return {'provider': provider_id, 'model': model_id, 'options': provider_options or {}}",
                "",
                "    async def test_connection():",
                "        return True, None",
                "",
                "    return {",
                "        'get_model': get_model,",
                "        'fetch_models': fetch_models,",
                "        'test_connection': test_connection,",
                "    }",
            ]
        )
    )


def _setup_manager(monkeypatch, tmp_path: Path) -> ppm.ProviderPluginManager:
    installed_root = tmp_path / "installed"
    installed_root.mkdir(parents=True, exist_ok=True)

    state_store: dict[str, dict[str, object]] = {}

    monkeypatch.setattr(ppm, "_provider_plugin_manager", None)
    monkeypatch.setattr(ppm, "_load_plugin_states", lambda: dict(state_store))

    def _save(states: dict[str, dict[str, object]]) -> None:
        state_store.clear()
        state_store.update(states)

    monkeypatch.setattr(ppm, "_save_plugin_states", _save)
    monkeypatch.setattr(ppm, "get_provider_plugins_directory", lambda: installed_root)
    monkeypatch.setattr(
        ppm,
        "get_provider_plugin_directory",
        lambda plugin_id: installed_root / plugin_id,
    )

    return ppm.ProviderPluginManager()


def _attach_signature(
    source_dir: Path,
    *,
    manager: ppm.ProviderPluginManager,
    signer_id: str,
    signature_bytes: bytes,
) -> bytes:
    raw_manifest = manager._read_manifest_from_directory(source_dir).raw
    expected_payload = manager._build_signature_payload(source_dir, raw_manifest)
    signature_b64 = base64.b64encode(signature_bytes).decode("utf-8")

    _write_code_plugin(
        source_dir,
        signature=signature_b64,
        signing_key_id=signer_id,
        signature_algorithm="ed25519",
    )
    return expected_payload


class _StubVerifier:
    def __init__(self, *, expected_payload: bytes, signature_bytes: bytes) -> None:
        self.expected_payload = expected_payload
        self.signature_bytes = signature_bytes

    def verify(self, signature: bytes, payload: bytes) -> None:
        if signature != self.signature_bytes or payload != self.expected_payload:
            raise InvalidSignature


def test_provider_plugin_manager_lifecycle(monkeypatch, tmp_path: Path) -> None:
    manager = _setup_manager(monkeypatch, tmp_path)

    source_dir = tmp_path / "source-plugin"
    source_dir.mkdir(parents=True, exist_ok=True)
    _write_code_plugin(source_dir)

    plugin_id = manager.import_from_directory(source_dir)
    assert plugin_id == "community-echo"

    manifest = manager.get_manifest(plugin_id)
    assert manifest is not None
    assert manifest.provider == "community_echo"
    assert manifest.entrypoint == "plugin:create_provider"

    plugins = manager.list_plugins()
    assert len(plugins) == 1
    assert plugins[0].id == "community-echo"
    assert plugins[0].enabled is True
    assert plugins[0].verification_status == "unsigned"

    assert manager.enable_plugin("community-echo", False) is True
    assert manager.get_enabled_manifests() == []

    assert manager.enable_plugin("community-echo", True) is True
    assert [m.id for m in manager.get_enabled_manifests()] == ["community-echo"]

    assert manager.uninstall("community-echo") is True
    assert manager.list_plugins() == []


def test_provider_plugin_verification_signed_and_tamper_detected(monkeypatch, tmp_path: Path) -> None:
    manager = _setup_manager(monkeypatch, tmp_path)

    source_dir = tmp_path / "signed-plugin"
    source_dir.mkdir(parents=True, exist_ok=True)
    _write_code_plugin(source_dir)

    signer_id = "test-signer"
    signature_bytes = b"signed-payload"
    expected_payload = _attach_signature(
        source_dir,
        manager=manager,
        signer_id=signer_id,
        signature_bytes=signature_bytes,
    )

    monkeypatch.setattr(
        ppm,
        "_load_trusted_signing_keys",
        lambda: {signer_id: _StubVerifier(expected_payload=expected_payload, signature_bytes=signature_bytes)},
    )

    plugin_id = manager.import_from_directory(source_dir)
    info = manager.get_plugin_info(plugin_id)
    assert info is not None
    assert info.verification_status == "verified"
    assert info.signing_key_id == signer_id

    installed_plugin = (tmp_path / "installed" / plugin_id / "plugin.py")
    installed_plugin.write_text(installed_plugin.read_text() + "\n# tampered\n")

    tampered = manager.get_plugin_info(plugin_id)
    assert tampered is not None
    assert tampered.verification_status == "invalid"


def test_provider_plugin_verification_untrusted_signer(monkeypatch, tmp_path: Path) -> None:
    manager = _setup_manager(monkeypatch, tmp_path)

    source_dir = tmp_path / "untrusted-plugin"
    source_dir.mkdir(parents=True, exist_ok=True)
    _write_code_plugin(source_dir)

    _attach_signature(
        source_dir,
        manager=manager,
        signer_id="unknown-signer",
        signature_bytes=b"stub-signature",
    )

    monkeypatch.setattr(ppm, "_load_trusted_signing_keys", lambda: {})

    plugin_id = manager.import_from_directory(source_dir)
    info = manager.get_plugin_info(plugin_id)
    assert info is not None
    assert info.verification_status == "untrusted"
    assert info.verification_message is not None
    assert "not trusted" in info.verification_message


def test_provider_plugin_signature_manifest_validation(tmp_path: Path) -> None:
    source_dir = tmp_path / "invalid-signature-plugin"
    source_dir.mkdir(parents=True, exist_ok=True)

    _write_code_plugin(
        source_dir,
        signature="not-base64",
        signing_key_id="bad-signer",
        signature_algorithm="ed25519",
    )

    manager = ppm.ProviderPluginManager()
    try:
        manager._read_manifest_from_directory(source_dir)
    except ValueError as exc:
        assert "valid base64" in str(exc)
    else:
        raise AssertionError("Expected invalid signature manifest to fail")
