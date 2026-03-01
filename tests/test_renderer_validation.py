from __future__ import annotations

import pytest

from backend.models.tooling import (
    validate_renderer_manifest_entry,
    validate_renderer_override,
)


def test_validate_renderer_manifest_entry_rejects_unknown_key_for_document() -> None:
    with pytest.raises(ValueError, match=r"unknown key\(s\)"):
        validate_renderer_manifest_entry(
            {
                "type": "document",
                "content": "$return",
                "editable": True,
                "url": "https://example.com",
            },
            context="tools[0].renderer",
        )


def test_validate_renderer_manifest_entry_allows_html_data() -> None:
    renderer, config = validate_renderer_manifest_entry(
        {
            "type": "html",
            "artifact": "artifacts/report.html",
            "data": {"items": [1, 2, 3]},
        },
        context="tools[0].renderer",
    )

    assert renderer == "html"
    assert config == {
        "artifact": "artifacts/report.html",
        "data": {"items": [1, 2, 3]},
    }


def test_validate_renderer_override_rejects_unknown_key_for_frame() -> None:
    with pytest.raises(ValueError, match=r"unknown key\(s\)"):
        validate_renderer_override(
            renderer="frame",
            renderer_config={"url": "http://localhost:3000", "editable": True},
            context="tool_override[test:tool]",
        )


def test_validate_renderer_override_rejects_unknown_key_for_default() -> None:
    with pytest.raises(ValueError, match=r"unknown key\(s\)"):
        validate_renderer_override(
            renderer="default",
            renderer_config={"content": "oops"},
            context="tool_override[test:tool]",
        )


def test_validate_renderer_override_rejects_non_string_code_language() -> None:
    with pytest.raises(ValueError, match="renderer_config.language must be a string"):
        validate_renderer_override(
            renderer="code",
            renderer_config={"content": "print('ok')", "language": 123},
            context="tool_override[test:tool]",
        )
