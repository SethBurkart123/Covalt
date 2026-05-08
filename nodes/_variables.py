"""Variable specs — canonical shape for any user-facing typed input.

This file is the single source of truth for VariableSpec / ControlKind /
OptionsSource / VariableOption. nodes/_variables.ts is a hand-mirrored 1:1
copy of these dataclasses — keep field names (snake_case) identical across
the wire so there is no mid-flight translation. When this file changes,
update nodes/_variables.ts in lockstep.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

ControlKindId = Literal[
    "text",
    "text-area",
    "number",
    "slider",
    "boolean",
    "select",
    "searchable",
]

VARIABLE_LINK_HANDLE_PREFIX = "vars/"


def variable_id_suffix(value: str) -> str:
    normalized = "".join(
        char.lower() if char.isalnum() else "_" for char in str(value)
    ).strip("_")
    return normalized or "node"


def node_model_variable_id(node_id: str) -> str:
    return f"model_{variable_id_suffix(node_id)}"


def variable_link_handle(spec_id: str) -> str:
    return f"{VARIABLE_LINK_HANDLE_PREFIX}{spec_id}"


def variable_id_from_link_handle(handle: str | None) -> str | None:
    if not isinstance(handle, str) or not handle.startswith(VARIABLE_LINK_HANDLE_PREFIX):
        return None
    candidate = handle[len(VARIABLE_LINK_HANDLE_PREFIX) :]
    return candidate or None


@dataclass(slots=True)
class VariableOption:
    value: Any
    label: str
    group: str | None = None
    icon: str | None = None


@dataclass(slots=True)
class ControlKind:
    kind: ControlKindId
    placeholder: str | None = None
    rows: int | None = None
    min: float | None = None
    max: float | None = None
    step: float | None = None
    multi: bool = False
    grouped: bool = False


@dataclass(slots=True)
class OptionsSource:
    kind: Literal["static", "link", "callback"]
    options: list[VariableOption] = field(default_factory=list)
    socket_type: str | None = None
    load: str | None = None
    params: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class VariableSpec:
    id: str
    label: str
    control: ControlKind
    description: str | None = None
    section: str | None = None
    options: OptionsSource | None = None
    default: Any = None
    required: bool = False
    placement: Literal["header", "advanced"] = "header"
    show_when: dict[str, Any] | None = None
    contributed_by: str | None = None


def control_kind_from_dict(raw: Any) -> ControlKind:
    if not isinstance(raw, dict):
        raise ValueError(f"control must be an object, got {type(raw).__name__}")
    kind = raw.get("kind")
    if kind not in {
        "text",
        "text-area",
        "number",
        "slider",
        "boolean",
        "select",
        "searchable",
    }:
        raise ValueError(f"unknown control kind: {kind!r}")
    return ControlKind(
        kind=kind,
        placeholder=raw.get("placeholder"),
        rows=raw.get("rows"),
        min=raw.get("min"),
        max=raw.get("max"),
        step=raw.get("step"),
        multi=bool(raw.get("multi", False)),
        grouped=bool(raw.get("grouped", False)),
    )


def options_source_from_dict(raw: Any) -> OptionsSource | None:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError("options must be an object")

    kind = raw.get("kind")
    if kind == "static":
        return OptionsSource(
            kind="static",
            options=[_option_from_dict(item) for item in raw.get("options", [])],
        )
    if kind == "link":
        socket_type = raw.get("socketType")
        if not isinstance(socket_type, str) or not socket_type:
            raise ValueError("link options source requires a non-empty socketType")
        return OptionsSource(kind="link", socket_type=socket_type)
    if kind == "callback":
        load = raw.get("load")
        if not isinstance(load, str) or not load:
            raise ValueError("callback options source requires a load identifier")
        params = raw.get("params") or {}
        if not isinstance(params, dict):
            raise ValueError("callback options params must be an object")
        return OptionsSource(kind="callback", load=load, params=dict(params))

    raise ValueError(f"unknown options source kind: {kind!r}")


def _option_from_dict(raw: Any) -> VariableOption:
    if not isinstance(raw, dict):
        raise ValueError("option entries must be objects")
    if "value" not in raw or "label" not in raw:
        raise ValueError("option entries require value and label")
    return VariableOption(
        value=raw["value"],
        label=str(raw["label"]),
        group=raw.get("group"),
        icon=raw.get("icon"),
    )


def variable_spec_from_dict(raw: Any) -> VariableSpec:
    if not isinstance(raw, dict):
        raise ValueError("variable spec must be an object")
    spec_id = raw.get("id")
    if not isinstance(spec_id, str) or not spec_id:
        raise ValueError("variable spec requires a non-empty id")
    label = raw.get("label")
    if not isinstance(label, str):
        raise ValueError(f"variable spec {spec_id} requires a label")

    show_when_raw = raw.get("show_when")
    return VariableSpec(
        id=spec_id,
        label=label,
        control=control_kind_from_dict(raw.get("control")),
        description=raw.get("description"),
        section=raw.get("section"),
        options=options_source_from_dict(raw.get("options")),
        default=raw.get("default"),
        required=bool(raw.get("required", False)),
        placement=raw.get("placement", "header") or "header",
        show_when=show_when_raw if isinstance(show_when_raw, dict) else None,
        contributed_by=raw.get("contributed_by"),
    )


def variable_spec_to_dict(spec: VariableSpec) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": spec.id,
        "label": spec.label,
        "control": _control_to_dict(spec.control),
        "required": spec.required,
        "placement": spec.placement,
    }
    if spec.description:
        out["description"] = spec.description
    if spec.section:
        out["section"] = spec.section
    if spec.options is not None:
        out["options"] = _options_to_dict(spec.options)
    if spec.default is not None:
        out["default"] = spec.default
    if spec.show_when is not None:
        out["show_when"] = spec.show_when
    if spec.contributed_by:
        out["contributed_by"] = spec.contributed_by
    return out


def _control_to_dict(control: ControlKind) -> dict[str, Any]:
    out: dict[str, Any] = {"kind": control.kind}
    if control.placeholder is not None:
        out["placeholder"] = control.placeholder
    if control.rows is not None:
        out["rows"] = control.rows
    if control.min is not None:
        out["min"] = control.min
    if control.max is not None:
        out["max"] = control.max
    if control.step is not None:
        out["step"] = control.step
    if control.multi:
        out["multi"] = True
    if control.grouped:
        out["grouped"] = True
    return out


def _options_to_dict(source: OptionsSource) -> dict[str, Any]:
    if source.kind == "static":
        return {
            "kind": "static",
            "options": [
                {
                    "value": option.value,
                    "label": option.label,
                    **({"group": option.group} if option.group else {}),
                    **({"icon": option.icon} if option.icon else {}),
                }
                for option in source.options
            ],
        }
    if source.kind == "link":
        return {"kind": "link", "socketType": source.socket_type}
    if source.kind == "callback":
        out: dict[str, Any] = {"kind": "callback", "load": source.load}
        if source.params:
            out["params"] = dict(source.params)
        return out
    raise ValueError(f"unknown options source kind: {source.kind}")
