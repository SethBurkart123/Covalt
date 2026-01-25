import type { RendererDefinition, ToolCallRenderer } from "./types";
import { defaultRenderer } from "@/components/tool-renderers/default";
import { codeRenderer } from "@/components/tool-renderers/code";
import { markdownRenderer } from "@/components/tool-renderers/markdown";
import { htmlRenderer } from "@/components/tool-renderers/html";

/**
 * All registered tool call renderers.
 * Similar to PROVIDERS in ProviderRegistry, this is a declarative array
 * that defines all available renderers.
 */
export const RENDERERS: RendererDefinition[] = [
  defaultRenderer,
  codeRenderer,
  markdownRenderer,
  htmlRenderer,
];

/**
 * Map for O(1) renderer lookup by key.
 */
const rendererMap = new Map<string, ToolCallRenderer>(
  RENDERERS.map((r) => [r.key, r.component])
);

/**
 * Get a tool call renderer by name.
 * Falls back to default renderer if not found.
 */
export function getToolCallRenderer(name?: string): ToolCallRenderer {
  return rendererMap.get(name || "default") || rendererMap.get("default")!;
}

/**
 * Map of renderer keys to their definitions for easy lookup.
 */
export const RENDERER_MAP = Object.fromEntries(
  RENDERERS.map((r) => [r.key, r])
);
