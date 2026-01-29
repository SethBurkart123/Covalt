import type { ServerFormData, ServerType } from "./types";
import type { KeyValuePair } from "@/components/ui/key-value-input";

export function configToFormData(
  id: string,
  config: Record<string, unknown>
): ServerFormData {
  const serverType: ServerType =
    config.type === "sse" || config.type === "streamable-http" || config.type === "stdio"
      ? config.type
      : "stdio";

  const baseCommand = (config.command as string) || "";
  const args = Array.isArray(config.args)
    ? (config.args as string[]).map((arg) => (arg.includes(" ") ? `"${arg}"` : arg)).join(" ")
    : "";
  const fullCommand = args ? `${baseCommand} ${args}`.trim() : baseCommand;

  const envVars: KeyValuePair[] = config.env && typeof config.env === "object"
    ? Object.entries(config.env as Record<string, string>).map(([key, value]) => ({
        key,
        value: value === "***" ? "" : value,
      }))
    : [];

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

  return { command: tokens[0] || "", args: tokens.slice(1) };
}
