from __future__ import annotations

from ..services.tool_registry import tool


@tool(name="E2E Echo", renderer="document")
def e2e_echo(text: str) -> str:
    """Echo text for end-to-end tool rendering tests."""
    return text


@tool(name="E2E Approval", renderer="document", requires_confirmation=True)
def e2e_requires_approval(text: str) -> str:
    """Tool that requires approval to verify HITL tool flows."""
    return text
