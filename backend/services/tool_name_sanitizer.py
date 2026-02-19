from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Union


class ToolNameSanitizer:
    def __init__(self, allowed_chars: str, max_len: int = 128) -> None:
        self.allowed_chars = allowed_chars
        self.max_len = max_len
        self._allowed_re = re.compile(rf"^[{allowed_chars}]+$")
        self._replace_re = re.compile(rf"[^{allowed_chars}]")
        self._safe_to_original: Dict[str, str] = {}
        self._original_to_safe: Dict[str, str] = {}
        self._used: set[str] = set()

    def map_original_to_safe(self, name: str) -> str:
        return self._sanitize(name)

    def map_safe_to_original(self, name: str) -> str:
        return self._safe_to_original.get(name, name)

    def sanitize_tool_choice(
        self, tool_choice: Optional[Union[str, Dict[str, Any]]]
    ) -> Optional[Union[str, Dict[str, Any]]]:
        if not isinstance(tool_choice, dict):
            return tool_choice
        name = tool_choice.get("name")
        if not isinstance(name, str) or not name:
            name = tool_choice.get("function", {}).get("name")
        if not isinstance(name, str) or not name:
            return tool_choice
        safe = self.map_original_to_safe(name)
        if safe == name:
            return tool_choice
        if "name" in tool_choice:
            updated = dict(tool_choice)
            updated["name"] = safe
            return updated
        function = tool_choice.get("function")
        if isinstance(function, dict):
            updated = dict(tool_choice)
            updated_function = dict(function)
            updated_function["name"] = safe
            updated["function"] = updated_function
            return updated
        return tool_choice

    def sanitize_tool_definitions(
        self, tools: Optional[List[Dict[str, Any]]]
    ) -> Optional[List[Dict[str, Any]]]:
        if not tools:
            return tools
        sanitized: List[Dict[str, Any]] = []
        for tool in tools:
            if not isinstance(tool, dict):
                sanitized.append(tool)
                continue
            if tool.get("type") != "function":
                sanitized.append(tool)
                continue

            if isinstance(tool.get("function"), dict):
                function = tool.get("function", {})
                name = function.get("name")
                safe = (
                    self.map_original_to_safe(name) if isinstance(name, str) else name
                )
                updated_function = dict(function)
                if isinstance(safe, str):
                    updated_function["name"] = safe
                updated_tool = dict(tool)
                updated_tool["function"] = updated_function
                sanitized.append(updated_tool)
                continue

            name = tool.get("name")
            safe = self.map_original_to_safe(name) if isinstance(name, str) else name
            updated_tool = dict(tool)
            if isinstance(safe, str):
                updated_tool["name"] = safe
            sanitized.append(updated_tool)

        return sanitized

    def sanitize_tool_calls(
        self, tool_calls: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        sanitized: List[Dict[str, Any]] = []
        for tool_call in tool_calls:
            if not isinstance(tool_call, dict):
                sanitized.append(tool_call)
                continue
            function = tool_call.get("function")
            if not isinstance(function, dict):
                sanitized.append(tool_call)
                continue
            name = function.get("name")
            if not isinstance(name, str):
                sanitized.append(tool_call)
                continue
            safe = self.map_original_to_safe(name)
            if safe == name:
                sanitized.append(tool_call)
                continue
            updated_tool_call = dict(tool_call)
            updated_function = dict(function)
            updated_function["name"] = safe
            updated_tool_call["function"] = updated_function
            sanitized.append(updated_tool_call)
        return sanitized

    def restore_tool_calls(
        self, tool_calls: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        restored: List[Dict[str, Any]] = []
        for tool_call in tool_calls:
            if not isinstance(tool_call, dict):
                restored.append(tool_call)
                continue
            function = tool_call.get("function")
            if not isinstance(function, dict):
                restored.append(tool_call)
                continue
            name = function.get("name")
            if not isinstance(name, str):
                restored.append(tool_call)
                continue
            original = self.map_safe_to_original(name)
            if original == name:
                restored.append(tool_call)
                continue
            updated_tool_call = dict(tool_call)
            updated_function = dict(function)
            updated_function["name"] = original
            updated_tool_call["function"] = updated_function
            restored.append(updated_tool_call)
        return restored

    def _sanitize(self, name: str) -> str:
        if name in self._original_to_safe:
            return self._original_to_safe[name]

        if self._allowed_re.match(name) and name not in self._used:
            self._used.add(name)
            return name

        base = self._replace_re.sub("_", name)
        if not base:
            base = "tool"
        base = base[: self.max_len]

        candidate = base
        suffix = 1
        while candidate in self._used:
            suffix += 1
            suffix_str = f"_{suffix}"
            trimmed = base[: max(1, self.max_len - len(suffix_str))]
            candidate = f"{trimmed}{suffix_str}"

        self._used.add(candidate)
        if candidate != name:
            self._safe_to_original[candidate] = name
            self._original_to_safe[name] = candidate
        return candidate
