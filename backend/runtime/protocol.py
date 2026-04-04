from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from typing import Any, Protocol

from .types import AgentConfig, ApprovalResponse, RuntimeEventT, RuntimeMessage


class AgentHandle(Protocol):
    async def run(
        self,
        messages: list[RuntimeMessage],
        *,
        add_history_to_context: bool = True,
    ) -> AsyncIterator[RuntimeEventT]: ...

    async def continue_run(
        self,
        approval: ApprovalResponse,
    ) -> AsyncIterator[RuntimeEventT]: ...

    def cancel(self, run_id: str | None = None) -> None: ...


class RuntimeAdapter(Protocol):
    def create_agent(
        self,
        config: AgentConfig,
        *,
        member_name: str | None = None,
        task: str | None = None,
        on_event: Callable[[RuntimeEventT], None] | None = None,
        runnable: Any | None = None,
    ) -> AgentHandle: ...
