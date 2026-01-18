import type { ServerFormData, ServerType } from "./types";
import type { KeyValuePair } from "@/components/ui/key-value-input";

/**
 * Converts an MCP server config from the API into form data for editing.
 */
export function configToFormData(
  id: string,
  config: Record<string, unknown>
): ServerFormData {
  let serverType: ServerType = "stdio";
  if (
    config.type &&
    typeof config.type === "string" &&
    (config.type === "sse" ||
      config.type === "streamable-http" ||
      config.type === "stdio")
  ) {
    serverType = config.type;
  }

  let fullCommand = (config.command as string) || "";
  if (config.args && Array.isArray(config.args)) {
    const argsStr = (config.args as string[])
      .map((arg) => (arg.includes(" ") ? `"${arg}"` : arg))
      .join(" ");
    if (argsStr) {
      fullCommand = fullCommand ? `${fullCommand} ${argsStr}` : argsStr;
    }
  }

  const envVars: KeyValuePair[] = [];
  if (config.env && typeof config.env === "object") {
    for (const [key, value] of Object.entries(
      config.env as Record<string, string>
    )) {
      envVars.push({ key, value: value === "***" ? "" : value });
    }
  }

  return {
    id,
    type: serverType,
    command: fullCommand,
    cwd: (config.cwd as string) || "",
    url: (config.url as string) || "",
    env: envVars,
    headers: config.headers ? JSON.stringify(config.headers, null, 2) : "",
    requiresConfirmation: config.requiresConfirmation !== false,
  };
}

/**
 * Parses a command string into command and args array.
 * Handles quoted arguments containing spaces.
 */
export function parseCommandString(cmdStr: string): {
  command: string;
  args: string[];
} {
  if (!cmdStr.trim()) return { command: "", args: [] };

  const tokens: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (const char of cmdStr.trim()) {
    if (!inQuote && (char === '"' || char === "'")) {
      inQuote = true;
      quoteChar = char;
    } else if (inQuote && char === quoteChar) {
      inQuote = false;
      quoteChar = "";
    } else if (!inQuote && char === " ") {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);

  if (tokens.length === 0) return { command: "", args: [] };
  return { command: tokens[0], args: tokens.slice(1) };
}
