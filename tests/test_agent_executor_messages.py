from __future__ import annotations

from backend.runtime import RuntimeAttachment, RuntimeMessage
from nodes.core.agent.executor import _resolve_run_input


def test_resolve_run_input_prefers_runtime_messages() -> None:
    runtime_messages = [
        RuntimeMessage(
            role="user",
            content="describe this",
            attachments=[
                RuntimeAttachment(
                    kind="image",
                    path="/tmp/fake-image.png",  # type: ignore[arg-type]
                    name="fake-image.png",
                )
            ],
        )
    ]

    resolved = _resolve_run_input(
        input_value={
            "runtime_messages": runtime_messages,
        },
        default_message="fallback",
    )

    assert isinstance(resolved, list)
    assert len(resolved) == 1
    assert resolved[0].role == "user"
    assert resolved[0].content == "describe this"
    assert resolved[0].attachments
    assert resolved[0].attachments[0].kind == "image"
