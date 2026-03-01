import type { RendererDefinition, ToolCallRenderer } from "./types";
import { defaultRenderer } from "@/components/tool-renderers/default";
import { codeRenderer } from "@/components/tool-renderers/code";
import { markdownRenderer } from "@/components/tool-renderers/markdown";
import { htmlRenderer } from "@/components/tool-renderers/html";
import { frameRenderer } from "@/components/tool-renderers/frame";

const DEFAULT_RENDERER_KEY = "default";

export const RENDERERS: RendererDefinition[] = [
  defaultRenderer,
  codeRenderer,
  markdownRenderer,
  htmlRenderer,
  frameRenderer,
];

const rendererByAlias = new Map<string, RendererDefinition>();
for (const renderer of RENDERERS) {
  for (const alias of renderer.aliases) {
    rendererByAlias.set(alias, renderer);
  }
}

const loadCache = new Map<string, Promise<ToolCallRenderer>>();

function getDefinitionByName(name?: string): RendererDefinition {
  if (name) {
    const byName = rendererByAlias.get(name);
    if (byName) {
      return byName;
    }
  }
  return rendererByAlias.get(DEFAULT_RENDERER_KEY)!;
}

function cacheLoad(definition: RendererDefinition): Promise<ToolCallRenderer> {
  const cached = loadCache.get(definition.key);
  if (cached) {
    return cached;
  }

  const promise = definition
    .load()
    .then((module) => module.default)
    .catch(async (error) => {
      if (definition.key !== DEFAULT_RENDERER_KEY) {
        console.error(
          `[ToolRenderers] Failed to load '${definition.key}' renderer, falling back to default`,
          error,
        );
        return getToolCallRenderer(DEFAULT_RENDERER_KEY);
      }
      throw error;
    });

  loadCache.set(definition.key, promise);
  return promise;
}

export function getToolCallRenderer(name?: string): Promise<ToolCallRenderer> {
  const definition = getDefinitionByName(name);
  return cacheLoad(definition);
}

export function preloadToolCallRenderer(name?: string): Promise<void> {
  return getToolCallRenderer(name).then(() => undefined);
}

export function listToolCallRenderers(): readonly RendererDefinition[] {
  return RENDERERS;
}

export const RENDERER_MAP = Object.fromEntries(
  RENDERERS.map((renderer) => [renderer.key, renderer]),
);
