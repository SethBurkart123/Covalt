import type { RendererDefinition, ToolCallRenderer } from "./types";
import { defaultRenderer } from "@/components/tool-renderers/default";
import { codeRenderer } from "@/components/tool-renderers/code";
import { markdownRenderer } from "@/components/tool-renderers/markdown";
import { htmlRenderer } from "@/components/tool-renderers/html";

export const RENDERERS: RendererDefinition[] = [
  defaultRenderer,
  codeRenderer,
  markdownRenderer,
  htmlRenderer,
];

const rendererMap = new Map<string, ToolCallRenderer>(
  RENDERERS.map((r) => [r.key, r.component])
);

export function getToolCallRenderer(name?: string): ToolCallRenderer {
  return rendererMap.get(name || "default") || rendererMap.get("default")!;
}

export const RENDERER_MAP = Object.fromEntries(
  RENDERERS.map((r) => [r.key, r])
);
