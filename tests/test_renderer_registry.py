from __future__ import annotations

from collections.abc import Iterator

import pytest

from backend.services.renderers.registry import (
    RendererRegistry,
    all_renderers,
    clear_registry,
    find_descriptor_by_tool_name,
    get_renderer,
    is_renderer_registered,
    list_renderer_keys,
    register_builtin_renderers,
    register_renderer,
    renderer_config_schema,
    resolve_renderer_alias,
)
from nodes._types import RendererDescriptor


@pytest.fixture(autouse=True)
def _clean_registry() -> Iterator[None]:
    clear_registry()
    yield
    clear_registry()
    register_builtin_renderers()


def test_register_and_lookup_descriptor() -> None:
    descriptor = RendererDescriptor(key="custom", config_schema={"x": "string"})
    register_renderer(descriptor)

    assert is_renderer_registered("custom") is True
    assert get_renderer("custom") == descriptor
    assert "custom" in list_renderer_keys()


def test_idempotent_re_registration_of_identical_descriptor() -> None:
    descriptor = RendererDescriptor(key="thing", config_schema={"a": "bool"})
    register_renderer(descriptor)
    register_renderer(descriptor)
    register_renderer(descriptor)

    assert list_renderer_keys() == ("thing",)


def test_duplicate_key_with_different_descriptor_raises() -> None:
    register_renderer(RendererDescriptor(key="dup", config_schema={"a": "string"}))

    with pytest.raises(ValueError, match="already registered"):
        register_renderer(RendererDescriptor(key="dup", config_schema={"b": "string"}))


def test_alias_collision_with_different_canonical_raises() -> None:
    register_renderer(
        RendererDescriptor(key="primary", aliases=("shared",), config_schema={})
    )

    with pytest.raises(ValueError, match="alias 'shared'"):
        register_renderer(
            RendererDescriptor(key="other", aliases=("shared",), config_schema={})
        )


def test_resolve_alias_returns_canonical_key() -> None:
    register_renderer(
        RendererDescriptor(key="document", aliases=("markdown",), config_schema={})
    )

    assert resolve_renderer_alias("markdown") == "document"
    assert resolve_renderer_alias("document") == "document"


def test_resolve_alias_passes_through_unknown_key() -> None:
    assert resolve_renderer_alias("never-registered") == "never-registered"


def test_config_schema_lookup_via_alias() -> None:
    schema = {"file": "string", "editable": "bool"}
    register_renderer(
        RendererDescriptor(key="document", aliases=("markdown",), config_schema=schema)
    )

    assert renderer_config_schema("document") == schema
    assert renderer_config_schema("markdown") == schema
    assert renderer_config_schema("missing") is None


def test_is_renderer_registered_handles_aliases() -> None:
    register_renderer(
        RendererDescriptor(key="document", aliases=("markdown",), config_schema={})
    )

    assert is_renderer_registered("document") is True
    assert is_renderer_registered("markdown") is True
    assert is_renderer_registered("nope") is False


def test_register_builtin_renderers_shape() -> None:
    register_builtin_renderers()

    expected_keys = {
        "default",
        "code",
        "document",
        "html",
        "frame",
        "editor",
        "terminal",
        "file-diff",
        "patch-diff",
        "web-search",
        "todo-list",
        "file-read",
        "key-value",
    }
    assert set(list_renderer_keys()) == expected_keys
    assert len(all_renderers()) == len(expected_keys)

    assert resolve_renderer_alias("markdown") == "document"
    assert is_renderer_registered("markdown") is True


def test_register_builtin_renderers_is_idempotent() -> None:
    register_builtin_renderers()
    register_builtin_renderers()
    register_builtin_renderers()

    assert len(list_renderer_keys()) == 13


def test_find_descriptor_by_tool_name_terminal_patterns() -> None:
    register_builtin_renderers()

    for tool in ("bash", "execute", "shell", "run_command", "exec", "BASH"):
        descriptor = find_descriptor_by_tool_name(tool)
        assert descriptor is not None
        assert descriptor.key == "terminal"


def test_find_descriptor_by_tool_name_file_diff_patterns() -> None:
    register_builtin_renderers()

    for tool in ("edit", "str_replace", "replace_in_file", "update_file", "write_file"):
        descriptor = find_descriptor_by_tool_name(tool)
        assert descriptor is not None
        assert descriptor.key == "file-diff"


def test_find_descriptor_by_tool_name_patch_diff_patterns() -> None:
    register_builtin_renderers()

    for tool in ("apply_patch", "applypatch", "patch"):
        descriptor = find_descriptor_by_tool_name(tool)
        assert descriptor is not None
        assert descriptor.key == "patch-diff"


def test_find_descriptor_by_tool_name_unknown_or_empty() -> None:
    register_builtin_renderers()

    assert find_descriptor_by_tool_name(None) is None
    assert find_descriptor_by_tool_name("") is None
    assert find_descriptor_by_tool_name("totally-unknown-name") is None


def test_registry_instance_independent_of_module_singleton() -> None:
    local = RendererRegistry()
    local.register(RendererDescriptor(key="local-only", config_schema={}))

    assert local.has("local-only")
    assert is_renderer_registered("local-only") is False
