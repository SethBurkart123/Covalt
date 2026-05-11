import { getToolRenderer } from "@/lib/renderers";
import type { ToolCallDisplayConfig, ToolCallRenderer } from "./types";
import { registerBuiltinToolRenderers } from "./builtin";

const DEFAULT_RENDERER_KEY = "default";

registerBuiltinToolRenderers();

const loadCache = new Map<string, Promise<ToolCallRenderer>>();

function resolveDefinitionKey(renderer?: string, toolName?: string): string {
  const def = getToolRenderer(renderer, toolName);
  if (def) return def.key;
  return DEFAULT_RENDERER_KEY;
}

function loadDefinition(key: string): Promise<ToolCallRenderer> {
  const cached = loadCache.get(key);
  if (cached) return cached;

  const def = getToolRenderer(key);
  if (!def?.tool) {
    if (key !== DEFAULT_RENDERER_KEY) {
      return getToolCallRenderer(DEFAULT_RENDERER_KEY);
    }
    return Promise.reject(new Error("Default tool renderer is not registered"));
  }

  const promise = def
    .tool()
    .then((module) => module.default as unknown as ToolCallRenderer)
    .catch(async (error) => {
      if (key !== DEFAULT_RENDERER_KEY) {
        console.error(
          `[ToolRenderers] Failed to load '${key}' renderer, falling back to default`,
          error,
        );
        return getToolCallRenderer(DEFAULT_RENDERER_KEY);
      }
      throw error;
    });

  loadCache.set(key, promise);
  return promise;
}

export function getToolCallRenderer(
  renderer?: string,
  toolName?: string,
): Promise<ToolCallRenderer> {
  return loadDefinition(resolveDefinitionKey(renderer, toolName));
}

export function preloadToolCallRenderer(
  renderer?: string,
  toolName?: string,
): Promise<void> {
  return getToolCallRenderer(renderer, toolName).then(() => undefined);
}

export function getToolCallRendererDisplay(
  renderer?: string,
  toolName?: string,
): ToolCallDisplayConfig | undefined {
  return getToolRenderer(renderer, toolName)?.display;
}
