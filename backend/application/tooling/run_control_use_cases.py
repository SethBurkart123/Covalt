from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any


@dataclass
class RespondToToolApprovalInput:
    run_id: str
    approved: bool
    tool_decisions: dict[str, bool] | None = None
    edited_args: dict[str, dict[str, Any]] | None = None


@dataclass
class RespondToToolApprovalDependencies:
    set_approval_response: Callable[
        [
            str,
            bool,
            dict[str, bool],
            dict[str, dict[str, Any]],
        ],
        None,
    ]


def execute_respond_to_tool_approval(
    input_data: RespondToToolApprovalInput,
    deps: RespondToToolApprovalDependencies,
) -> dict:
    deps.set_approval_response(
        input_data.run_id,
        input_data.approved,
        input_data.tool_decisions or {},
        input_data.edited_args or {},
    )
    return {"success": True}


@dataclass
class CancelRunInput:
    message_id: str


@dataclass
class CancelRunDependencies:
    get_active_run: Callable[[str], tuple[str | None, Any] | None]
    mark_early_cancel: Callable[[str], None]
    mark_message_complete: Callable[[str], None]
    remove_active_run: Callable[[str], tuple[str | None, Any] | None]
    cancel_approval_waiter: Callable[[str], bool]
    logger: Any


@dataclass
class CancelFlowRunInput:
    run_id: str


@dataclass
class CancelFlowRunDependencies:
    get_active_run: Callable[[str], tuple[str | None, Any] | None]
    mark_early_cancel: Callable[[str], None]
    remove_active_run: Callable[[str], tuple[str | None, Any] | None]
    cancel_approval_waiter: Callable[[str], bool]
    logger: Any


def _request_cancel(agent: Any) -> None:
    request_cancel = getattr(agent, "request_cancel", None)
    if callable(request_cancel):
        request_cancel()


def _cancel_run(agent: Any, run_id: str) -> None:
    cancel = getattr(agent, "cancel", None)
    if callable(cancel):
        cancel(run_id)


def execute_cancel_run(
    input_data: CancelRunInput,
    deps: CancelRunDependencies,
) -> dict:
    active_run = deps.get_active_run(input_data.message_id)
    if active_run is None:
        deps.logger.info(
            f"[cancel_run] No active run found for message {input_data.message_id}; storing early intent"
        )
        deps.mark_early_cancel(input_data.message_id)

        try:
            deps.mark_message_complete(input_data.message_id)
        except Exception as e:
            deps.logger.info(f"[cancel_run] Warning marking message complete: {e}")

        return {"cancelled": True}

    run_id, agent = active_run
    paused_at_hitl = False
    try:
        if run_id:
            deps.logger.info(
                f"[cancel_run] Cancelling run {run_id} for message {input_data.message_id}"
            )
            _cancel_run(agent, run_id)
            paused_at_hitl = deps.cancel_approval_waiter(run_id)
        else:
            deps.logger.info(
                f"[cancel_run] Flagging early cancel for message {input_data.message_id}"
            )
            deps.mark_early_cancel(input_data.message_id)
            _request_cancel(agent)

        # If paused at HITL, the stream handler will finalize and emit RUN_CANCELLED
        # itself once the approval waiter wakes up. Don't race ahead.
        if not paused_at_hitl:
            deps.mark_message_complete(input_data.message_id)
            if run_id:
                deps.remove_active_run(input_data.message_id)

        deps.logger.info(
            f"[cancel_run] Successfully cancelled for message {input_data.message_id}"
        )
        return {"cancelled": True}
    except Exception as e:
        deps.logger.info(f"[cancel_run] Error cancelling run: {e}")
        return {"cancelled": False}


def execute_cancel_flow_run(
    input_data: CancelFlowRunInput,
    deps: CancelFlowRunDependencies,
) -> dict:
    active_run = deps.get_active_run(input_data.run_id)
    if active_run is None:
        deps.logger.info(
            f"[cancel_flow_run] No active run found for flow run {input_data.run_id}"
        )
        return {"cancelled": False}

    run_id, agent = active_run
    paused_at_hitl = False
    try:
        if run_id:
            deps.logger.info(
                f"[cancel_flow_run] Cancelling run {run_id} for flow run {input_data.run_id}"
            )
            _cancel_run(agent, run_id)
            paused_at_hitl = deps.cancel_approval_waiter(run_id)
        else:
            deps.logger.info(
                f"[cancel_flow_run] Flagging early cancel for flow run {input_data.run_id}"
            )
            deps.mark_early_cancel(input_data.run_id)
            _request_cancel(agent)

        if run_id and not paused_at_hitl:
            deps.remove_active_run(input_data.run_id)

        deps.logger.info(
            f"[cancel_flow_run] Successfully cancelled for flow run {input_data.run_id}"
        )
        return {"cancelled": True}
    except Exception as e:
        deps.logger.info(f"[cancel_flow_run] Error cancelling run: {e}")
        return {"cancelled": False}
