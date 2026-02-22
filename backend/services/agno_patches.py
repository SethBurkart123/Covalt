from __future__ import annotations

from typing import Any

_PATCH_APPLIED = False


def apply_agno_patches() -> None:
    global _PATCH_APPLIED
    if _PATCH_APPLIED:
        return

    try:
        from agno.tools.function import Function
    except Exception:
        return

    original_to_dict = getattr(Function, "to_dict", None)
    if not callable(original_to_dict):
        return

    if getattr(original_to_dict, "__agno_app_strip_requires_confirmation__", False):
        _PATCH_APPLIED = True
        return

    def _to_dict_without_requires_confirmation(self: Any) -> dict[str, Any]:
        payload = original_to_dict(self)
        if isinstance(payload, dict):
            payload.pop("requires_confirmation", None)
        return payload

    setattr(
        _to_dict_without_requires_confirmation,
        "__agno_app_strip_requires_confirmation__",
        True,
    )
    Function.to_dict = _to_dict_without_requires_confirmation  # type: ignore[method-assign]
    _PATCH_APPLIED = True
