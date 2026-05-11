"""Translate droid SDK permission/ask_user request params into our generic
``ApprovalRequired`` event shape, and translate the collected tool decisions
back into the response payload the SDK expects.

The droid daemon dispatches two server→client request methods:
- ``droid.request_permission`` → list of ``ToolConfirmationInfo`` to approve.
- ``droid.ask_user`` → questionnaire to fill in.

Permission requests carry real tool_call_ids; we surface every tool so the
unified approval-session machinery (keyed by tool_call_id) can record one
decision per tool. Ask-user requests normally carry ``toolCallId`` too; when
older daemon payloads omit it we synthesize a single ``askuser:<uuid>`` id.
"""

from __future__ import annotations

import uuid
from typing import Any, Literal

from backend.runtime import (
    ApprovalEditable,
    ApprovalOption,
    ApprovalQuestion,
    ApprovalRequired,
    ApprovalResolved,
)
from backend.services.streaming.run_control import ApprovalSession, ToolDecisionRecord

RiskLevel = Literal["low", "medium", "high", "unknown"]
ApprovalRole = Literal[
    "allow_once", "allow_session", "allow_always", "deny", "abort", "custom"
]
ApprovalStyle = Literal["default", "primary", "destructive"]

_PERMISSION_OPTION_LABELS: dict[str, str] = {
    "proceed_once": "Allow",
    "proceed_always": "Allow always",
    "proceed_auto_run": "Allow auto-run",
    "proceed_auto_run_low": "Auto-run (low impact)",
    "proceed_auto_run_medium": "Auto-run (medium impact)",
    "proceed_auto_run_high": "Auto-run (high impact)",
    "proceed_edit": "Edit & allow",
    "cancel": "Deny",
}

_PERMISSION_OPTION_ROLES: dict[str, ApprovalRole] = {
    "proceed_once": "allow_once",
    "proceed_always": "allow_session",
    "proceed_auto_run": "allow_always",
    "proceed_auto_run_low": "allow_always",
    "proceed_auto_run_medium": "allow_always",
    "proceed_auto_run_high": "allow_always",
    "proceed_edit": "custom",
    "cancel": "deny",
}

_EDITABLE_PATHS_BY_TYPE: dict[str, list[str]] = {
    "exec": ["command"],
    "edit": ["new_str"],
    "create": ["content"],
    "apply_patch": ["patch"],
    "ask_user": [],
    "exit_spec_mode": [],
    "propose_mission": [],
    "start_mission_run": [],
    "mcp_tool": [],
}


def droid_permission_to_approval(
    params: dict[str, Any],
    *,
    run_id: str,
) -> tuple[ApprovalRequired, list[dict[str, Any]]]:
    """Build an ``ApprovalRequired`` event and the per-tool wire payloads.

    Permission requests carry a list of tool uses sharing a single decision.
    We surface every tool, but expose ``confirmation_type`` / ``details`` of
    the first entry as the renderer hint (the daemon batches identical types).
    """

    tool_uses = _coerce_list(params.get("toolUses"))
    options_raw = _coerce_list(params.get("options"))

    pending_tools: list[dict[str, Any]] = []
    tool_use_ids: list[str] = []
    confirmation_type = ""
    primary_details: dict[str, Any] = {}
    primary_tool_name = ""

    for entry in tool_uses:
        tool_use = _coerce_dict(entry.get("toolUse"))
        tool_id = str(tool_use.get("id") or "") or f"droid:{uuid.uuid4().hex}"
        tool_name = str(tool_use.get("name") or "")
        tool_input = _coerce_dict(tool_use.get("input"))
        ctype = str(entry.get("confirmationType") or "")
        details = _coerce_dict(entry.get("details"))

        if not confirmation_type:
            confirmation_type = ctype
            primary_details = details
            primary_tool_name = tool_name

        pending_tools.append(
            {
                "id": tool_id,
                "toolName": tool_name,
                "toolArgs": tool_input,
                "confirmationType": ctype,
                "details": details,
            }
        )
        tool_use_ids.append(tool_id)

    options = _build_permission_options(options_raw)
    editable = _editable_for_confirmation(confirmation_type, primary_details)
    risk_level = _risk_from_details(primary_details)
    summary = _summary_for_confirmation(
        confirmation_type, primary_details, primary_tool_name
    )

    event = ApprovalRequired(
        run_id=run_id,
        kind="tool_approval",
        tool_use_ids=tool_use_ids or None,
        tool_name=primary_tool_name or None,
        risk_level=risk_level,
        summary=summary,
        options=options,
        questions=[],
        editable=editable,
        renderer=None,
        config={
            "confirmation_type": confirmation_type,
            "details": primary_details,
            "pending_tools": pending_tools,
        },
        timeout_ms=None,
    )
    return event, pending_tools


def droid_ask_user_to_approval(
    params: dict[str, Any],
    *,
    run_id: str,
) -> tuple[ApprovalRequired, list[dict[str, Any]]]:
    raw_questions = _coerce_list(params.get("questions"))
    questions: list[ApprovalQuestion] = []
    for idx, entry in enumerate(raw_questions):
        if not isinstance(entry, dict):
            continue
        q_index = entry.get("index")
        if not isinstance(q_index, int):
            q_index = idx + 1
        options = entry.get("options")
        questions.append(
            ApprovalQuestion(
                index=q_index,
                topic=str(entry.get("topic") or ""),
                question=str(entry.get("question") or ""),
                options=[str(o) for o in options] if isinstance(options, list) else [],
                placeholder=_optional_str(entry.get("placeholder")),
                multiline=bool(entry.get("multiline", False)),
                required=bool(entry.get("required", True)),
            )
        )

    dialog_tool_id = str(params.get("toolCallId") or "") or f"askuser:{uuid.uuid4().hex}"
    pending_tools = [
        {
            "id": dialog_tool_id,
            "toolName": "ask_user",
            "toolArgs": {"questions": [
                {"index": q.index, "topic": q.topic, "question": q.question}
                for q in questions
            ]},
        }
    ]

    event = ApprovalRequired(
        run_id=run_id,
        kind="user_input",
        tool_use_ids=[dialog_tool_id],
        tool_name="ask_user",
        risk_level=None,
        summary=None,
        options=[
            ApprovalOption(
                value="submit",
                label="Submit",
                role="custom",
                style="primary",
                requires_input=True,
            ),
            ApprovalOption(value="cancel", label="Cancel", role="abort"),
        ],
        questions=questions,
        editable=[],
        renderer=None,
        config={"dialog_tool_id": dialog_tool_id, "pending_tools": pending_tools},
        timeout_ms=None,
    )
    return event, pending_tools


def droid_permission_response(session: ApprovalSession) -> str:
    if session.cancelled:
        return "cancel"
    for tool_id in session.tool_call_ids:
        record = session.decisions.get(tool_id)
        if record is None or record.cancelled:
            return "cancel"
        if record.selected_option == "cancel":
            return "cancel"
    first = session.decisions.get(session.tool_call_ids[0]) if session.tool_call_ids else None
    return first.selected_option if first and first.selected_option else "cancel"


def droid_ask_user_response(
    session: ApprovalSession,
    *,
    questions: list[ApprovalQuestion],
) -> dict[str, Any]:
    if session.cancelled or not session.tool_call_ids:
        return {"cancelled": True, "answers": []}
    record = session.decisions.get(session.tool_call_ids[0])
    if record is None or record.cancelled or record.selected_option == "cancel":
        return {"cancelled": True, "answers": []}

    question_lookup = {q.index: q.question for q in questions}
    answers_payload: list[dict[str, Any]] = []
    raw_answers = (record.edited_args or {}).get("answers")
    if isinstance(raw_answers, list):
        for entry in raw_answers:
            if not isinstance(entry, dict):
                continue
            index = entry.get("index")
            answer = entry.get("answer")
            if not isinstance(index, int) or not isinstance(answer, str):
                continue
            answers_payload.append(
                {
                    "index": index,
                    "question": question_lookup.get(index, ""),
                    "answer": answer,
                }
            )
    return {"cancelled": False, "answers": answers_payload}


def approval_resolved_event(
    *,
    run_id: str,
    session: ApprovalSession,
    pending_tools: list[dict[str, Any]],
) -> tuple[ApprovalResolved, list[dict[str, Any]]]:
    cancelled = session.cancelled
    selected_option = "cancel"
    if not cancelled and session.tool_call_ids:
        first = session.decisions.get(session.tool_call_ids[0])
        if first is not None:
            selected_option = first.selected_option or "cancel"
            cancelled = first.cancelled or selected_option == "cancel"
    edited_args: dict[str, Any] | None = None
    for tool_id in session.tool_call_ids:
        record = session.decisions.get(tool_id)
        if record and record.edited_args:
            edited_args = {**(edited_args or {}), **record.edited_args}

    resolved_tools: list[dict[str, Any]] = []
    for tool in pending_tools:
        tool_id = str(tool.get("id") or "")
        record: ToolDecisionRecord | None = session.decisions.get(tool_id)
        if cancelled or record is None or record.cancelled or record.selected_option == "cancel":
            status = "denied"
        else:
            status = "approved"
        resolved_tools.append(
            {
                "id": tool_id,
                "toolName": tool.get("toolName"),
                "approvalStatus": status,
                "toolArgs": (record.edited_args if record and record.edited_args else tool.get("toolArgs")),
            }
        )

    resolved = ApprovalResolved(
        run_id=run_id,
        selected_option=selected_option,
        answers=[],
        edited_args=edited_args,
        cancelled=cancelled,
    )
    return resolved, resolved_tools


def _build_permission_options(raw_options: list[Any]) -> list[ApprovalOption]:
    options: list[ApprovalOption] = []
    seen: set[str] = set()
    for entry in raw_options:
        if not isinstance(entry, dict):
            continue
        value = str(entry.get("value") or "")
        if not value or value in seen:
            continue
        seen.add(value)
        label = str(entry.get("label") or _PERMISSION_OPTION_LABELS.get(value, value))
        role: ApprovalRole = _PERMISSION_OPTION_ROLES.get(value, "custom")
        style: ApprovalStyle
        if value == "cancel":
            style = "destructive"
        elif value in {"proceed_once", "proceed_edit"}:
            style = "primary"
        else:
            style = "default"
        requires_input = value == "proceed_edit"
        options.append(
            ApprovalOption(
                value=value,
                label=label,
                role=role,
                style=style,
                requires_input=requires_input,
            )
        )

    if not options:
        options = [
            ApprovalOption(
                value="proceed_once", label="Allow", role="allow_once", style="primary"
            ),
            ApprovalOption(
                value="cancel", label="Deny", role="deny", style="destructive"
            ),
        ]
    return options


def _editable_for_confirmation(
    confirmation_type: str,
    details: dict[str, Any],
) -> list[ApprovalEditable]:
    paths = _EDITABLE_PATHS_BY_TYPE.get(confirmation_type, [])
    editable: list[ApprovalEditable] = []
    for path in paths:
        editable.append(
            ApprovalEditable(
                path=[path],
                schema={"type": "string"},
                label=_editable_label(confirmation_type, path),
            )
        )
    del details
    return editable


def _editable_label(confirmation_type: str, path: str) -> str | None:
    if confirmation_type == "exec" and path == "command":
        return "Command"
    if confirmation_type == "edit" and path == "new_str":
        return "New content"
    if confirmation_type == "create" and path == "content":
        return "File content"
    if confirmation_type == "apply_patch" and path == "patch":
        return "Patch"
    return None


def _summary_for_confirmation(
    confirmation_type: str,
    details: dict[str, Any],
    tool_name: str,
) -> str | None:
    if confirmation_type == "exec":
        command = details.get("fullCommand") or details.get("command")
        if command:
            return f"Run command: {command}"
    if confirmation_type == "edit":
        path = details.get("filePath") or details.get("fileName")
        if path:
            return f"Edit {path}"
    if confirmation_type == "create":
        path = details.get("filePath") or details.get("fileName")
        if path:
            return f"Create {path}"
    if confirmation_type == "apply_patch":
        path = details.get("filePath") or details.get("fileName")
        if path:
            return f"Apply patch to {path}"
    if confirmation_type == "mcp_tool":
        name = details.get("toolName") or tool_name
        if name:
            return f"Call MCP tool: {name}"
    if confirmation_type == "exit_spec_mode":
        title = details.get("title") or "Exit spec mode"
        return str(title)
    if confirmation_type == "propose_mission":
        title = details.get("title") or "Propose mission"
        return str(title)
    if confirmation_type == "start_mission_run":
        return "Start mission run"
    if tool_name:
        return f"Approve tool: {tool_name}"
    return None


def _risk_from_details(details: dict[str, Any]) -> RiskLevel | None:
    impact = details.get("impactLevel")
    if not isinstance(impact, str):
        return None
    normalized = impact.strip().lower()
    if normalized == "low":
        return "low"
    if normalized == "medium":
        return "medium"
    if normalized == "high":
        return "high"
    return "unknown"


def _coerce_list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def _coerce_dict(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _optional_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value)
    return text if text else None
