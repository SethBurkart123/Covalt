import type { ToolCallRenderer } from "./types";

const renderers = new Map<string, ToolCallRenderer>();

export function registerToolCallRenderer(name: string, component: ToolCallRenderer) {
  renderers.set(name, component);
}

export function getToolCallRenderer(name?: string): ToolCallRenderer {
  return renderers.get(name || "default") || renderers.get("default")!;
}
