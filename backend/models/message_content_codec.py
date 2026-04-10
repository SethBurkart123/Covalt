from __future__ import annotations

from typing import Any

import orjson


def _normalize_blocks(value: list[Any]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for block in value:
        if isinstance(block, dict):
            normalized.append(block)
        else:
            normalized.append({"type": "text", "content": str(block)})
    return normalized


def _is_delegation_block(block: dict[str, Any]) -> bool:
    return block.get("type") == "tool_call" and bool(block.get("isDelegation"))


def decode_message_content(content: Any) -> Any:
    """Decode persisted message content into runtime shape.

    Stringified JSON block arrays are decoded into list[dict]. Other values are
    returned unchanged to preserve existing behavior. Legacy delegation tool
    blocks are stripped on read.
    """
    if not isinstance(content, str):
        return content

    raw = content.strip()
    if not raw.startswith("["):
        return content

    try:
        parsed = orjson.loads(raw)
    except Exception:
        return content

    if not isinstance(parsed, list):
        return content

    return [b for b in _normalize_blocks(parsed) if not _is_delegation_block(b)]


def parse_message_blocks(
    content: Any,
    *,
    strip_trailing_errors: bool = False,
) -> list[dict[str, Any]]:
    """Parse content as block list with string fallback semantics."""
    if content is None:
        return []

    if isinstance(content, list):
        blocks = _normalize_blocks(content)
    elif isinstance(content, str):
        raw = content.strip()
        if not raw:
            return []
        decoded = decode_message_content(content)
        if isinstance(decoded, list):
            blocks = decoded
        else:
            blocks = [{"type": "text", "content": content}]
    else:
        blocks = [{"type": "text", "content": str(content)}]

    if strip_trailing_errors:
        while blocks and blocks[-1].get("type") == "error":
            blocks.pop()

    return blocks


def serialize_message_blocks(blocks: list[dict[str, Any]]) -> str:
    """Serialize block list for DB persistence."""
    return orjson.dumps(blocks).decode()
