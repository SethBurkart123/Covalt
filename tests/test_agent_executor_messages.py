from __future__ import annotations

from agno.media import Image

from nodes.core.agent.executor import _resolve_run_input


def test_resolve_run_input_prefers_agno_messages_for_multimodal() -> None:
    agno_messages = [
        {
            "role": "user",
            "content": "describe this",
            "images": [Image(content=b"\x89PNG\r\n\x1a\nfake")],
        }
    ]

    resolved = _resolve_run_input(
        input_value={
            "messages": [{"role": "user", "content": "text-only"}],
            "agno_messages": agno_messages,
        },
        default_message="fallback",
    )

    assert isinstance(resolved, list)
    assert len(resolved) == 1
    assert resolved[0].role == "user"
    assert resolved[0].content == "describe this"
    assert resolved[0].images is not None
    assert len(resolved[0].images) == 1
