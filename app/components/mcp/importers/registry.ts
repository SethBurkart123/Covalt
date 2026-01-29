import type { ComponentType } from "react";
import type { ImportSource } from "./types";
import ClaudeDesktopIcon from "./icons/ClaudeDesktop";
import ClaudeCodeIcon from "./icons/ClaudeCode";
import OpenCodeIcon from "./icons/OpenCode";
import CursorIcon from "./icons/Cursor";

export interface ImportSourceWithIcon extends ImportSource {
  icon: ComponentType;
}

export const IMPORT_SOURCES: ImportSourceWithIcon[] = [
  {
    key: "claude-desktop",
    name: "Claude Desktop",
    icon: ClaudeDesktopIcon,
    configPaths: {
      darwin: ["~/Library/Application Support/Claude/claude_desktop_config.json"],
      win32: ["%APPDATA%\\Claude\\claude_desktop_config.json"],
      linux: ["~/.config/Claude/claude_desktop_config.json"],
    },
    rootKey: "mcpServers",
  },
  {
    key: "claude-code",
    name: "Claude Code",
    icon: ClaudeCodeIcon,
    configPaths: {
      darwin: ["~/.claude.json"],
      win32: ["%USERPROFILE%\\.claude.json"],
      linux: ["~/.claude.json"],
    },
    rootKey: "mcpServers",
  },
  {
    key: "opencode",
    name: "OpenCode",
    icon: OpenCodeIcon,
    configPaths: {
      darwin: ["~/.config/opencode/opencode.json"],
      win32: ["%APPDATA%\\opencode\\opencode.json"],
      linux: ["~/.config/opencode/opencode.json"],
    },
    rootKey: "mcp",
  },
  {
    key: "cursor",
    name: "Cursor",
    icon: CursorIcon,
    configPaths: {
      darwin: ["~/.cursor/mcp.json"],
      win32: ["%USERPROFILE%\\.cursor\\mcp.json"],
      linux: ["~/.cursor/mcp.json"],
    },
    rootKey: "mcpServers",
  },
];

export const IMPORT_SOURCE_MAP = Object.fromEntries(
  IMPORT_SOURCES.map((source) => [source.key, source])
) as Record<string, ImportSourceWithIcon>;
