from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from backend.services import node_provider_runtime as runtime


def _runtime_spec(tmp_path: Path) -> runtime.NodeProviderRuntimeSpec:
    plugin_dir = tmp_path / "plugin"
    plugin_dir.mkdir(parents=True, exist_ok=True)
    (plugin_dir / "runtime.js").write_text("// fake runtime entrypoint")

    return runtime.NodeProviderRuntimeSpec(
        plugin_id="plugin-123",
        provider_id="provider-123",
        plugin_dir=plugin_dir,
        entrypoint="runtime.js",
    )


def _mock_run(
    monkeypatch: pytest.MonkeyPatch,
    *,
    returncode: int = 0,
    stdout: str = "",
    stderr: str = "",
) -> None:
    def _fake_run(*_args, **_kwargs) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess(
            args=["bun", "runtime.js"],
            returncode=returncode,
            stdout=stdout,
            stderr=stderr,
        )

    monkeypatch.setattr(runtime.subprocess, "run", _fake_run)


def test_empty_stdout_error_includes_plugin_method_and_empty_response(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    spec = _runtime_spec(tmp_path)
    _mock_run(monkeypatch, stdout="   ", stderr="runtime warning")

    with pytest.raises(runtime.NodeProviderRuntimeError) as exc_info:
        runtime.list_provider_definitions(spec)

    message = str(exc_info.value)
    assert "plugin-123" in message
    assert "list_definitions" in message
    assert "empty response" in message.lower()
    assert "runtime warning" in message


def test_invalid_json_error_includes_plugin_method_and_output_snippet(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    spec = _runtime_spec(tmp_path)
    _mock_run(
        monkeypatch,
        stdout="<<<not-json-payload>>>",
        stderr="runtime stderr",
    )

    with pytest.raises(runtime.NodeProviderRuntimeError) as exc_info:
        runtime.execute_provider_node(spec, {})

    message = str(exc_info.value)
    assert "plugin-123" in message
    assert "execute" in message
    assert "invalid json" in message.lower()
    assert "<<<not-json-payload>>>" in message
    assert "runtime stderr" in message


def test_non_object_result_error_includes_plugin_method_and_expected_shape(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    spec = _runtime_spec(tmp_path)
    _mock_run(
        monkeypatch,
        stdout=json.dumps({"ok": True, "result": ["not", "an", "object"]}),
        stderr="shape stderr",
    )

    with pytest.raises(runtime.NodeProviderRuntimeError) as exc_info:
        runtime.materialize_provider_node(spec, {})

    message = str(exc_info.value)
    assert "plugin-123" in message
    assert "materialize" in message
    assert "expected" in message.lower()
    assert "result" in message.lower()
    assert "shape stderr" in message


def test_error_envelope_includes_plugin_method_and_envelope_message(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    spec = _runtime_spec(tmp_path)
    _mock_run(
        monkeypatch,
        stdout=json.dumps({"ok": False, "error": {"message": "provider said no"}}),
        stderr="envelope stderr",
    )

    with pytest.raises(runtime.NodeProviderRuntimeError) as exc_info:
        runtime.handle_provider_route(spec, {})

    message = str(exc_info.value)
    assert "plugin-123" in message
    assert "handle_route" in message
    assert "provider said no" in message
    assert "envelope stderr" in message


def test_non_zero_exit_error_includes_plugin_method_and_stderr(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    spec = _runtime_spec(tmp_path)
    _mock_run(
        monkeypatch,
        returncode=3,
        stdout="",
        stderr="bun runtime blew up",
    )

    with pytest.raises(runtime.NodeProviderRuntimeError) as exc_info:
        runtime.configure_provider_runtime(spec, {})

    message = str(exc_info.value)
    assert "plugin-123" in message
    assert "configure_runtime" in message
    assert "exit" in message.lower()
    assert "bun runtime blew up" in message


def test_missing_entrypoint_error_includes_plugin_and_method_context(tmp_path: Path) -> None:
    plugin_dir = tmp_path / "plugin-missing-entry"
    plugin_dir.mkdir(parents=True, exist_ok=True)

    spec = runtime.NodeProviderRuntimeSpec(
        plugin_id="plugin-123",
        provider_id="provider-123",
        plugin_dir=plugin_dir,
        entrypoint="missing-runtime.js",
    )

    with pytest.raises(runtime.NodeProviderRuntimeError) as exc_info:
        runtime.list_provider_definitions(spec)

    message = str(exc_info.value)
    assert "plugin-123" in message
    assert "list_definitions" in message
    assert "missing runtime entrypoint" in message.lower()


def test_invalid_definitions_shape_error_includes_method_context(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    spec = _runtime_spec(tmp_path)
    _mock_run(
        monkeypatch,
        stdout=json.dumps({"ok": True, "result": {"definitions": "not-a-list"}}),
        stderr="",
    )

    with pytest.raises(runtime.NodeProviderRuntimeError) as exc_info:
        runtime.list_provider_definitions(spec)

    message = str(exc_info.value)
    assert "plugin-123" in message
    assert "list_definitions" in message
    assert "invalid definitions" in message.lower()
