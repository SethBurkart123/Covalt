import type { ToolCallPayload } from "@/lib/types/chat";

const PATCH_KEYS = ["patch", "input", "diff", "patchText"];

function pickString(source: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

export function extractPatchText(
  config: Record<string, unknown> | undefined,
  toolCall: ToolCallPayload | undefined,
): string {
  const fromConfig = pickString(config, PATCH_KEYS);
  if (fromConfig) return fromConfig;

  const fromArgs = pickString(toolCall?.toolArgs, PATCH_KEYS);
  if (fromArgs) return fromArgs;

  const result = toolCall?.toolResult;
  if (typeof result === "string" && result.includes("*** Begin Patch")) return result;

  return "";
}
