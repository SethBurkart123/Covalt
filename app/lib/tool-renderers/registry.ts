import { getToolRenderer } from "@/lib/renderers";
import type { ToolCallRenderer } from "./types";
import { registerBuiltinToolRenderers } from "./builtin";

const DEFAULT_RENDERER_KEY = "default";

registerBuiltinToolRenderers();

const loadCache = new Map<string, Promise<ToolCallRenderer>>();

function resolveDefinitionKey(name?: string): string {
  if (name) {
    const def = getToolRenderer(name);
    if (def) return def.key;
  }
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

export function getToolCallRenderer(name?: string): Promise<ToolCallRenderer> {
  return loadDefinition(resolveDefinitionKey(name));
}

export function preloadToolCallRenderer(name?: string): Promise<void> {
  return getToolCallRenderer(name).then(() => undefined);
}
