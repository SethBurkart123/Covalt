import type {
  ApprovalRenderer,
  MessageRenderer,
  ToolRenderer,
} from "./contracts";
import type { MessageRendererMatch } from "./types";

// Superset of nodes/_manifest.ts RendererDefinition: same key/aliases/toolNamePatterns/configSchema
// shape, plus runtime-only component loaders that the manifest cannot reference.
export interface RendererDefinition {
  key: string;
  aliases?: string[];
  toolNamePatterns?: (string | RegExp)[];
  configSchema?: Record<string, "string" | "bool" | "port" | "any">;
  matchMessage?: (content: string) => MessageRendererMatch[];
  tool?: () => Promise<{ default: ToolRenderer }>;
  approval?: () => Promise<{ default: ApprovalRenderer }>;
  message?: () => Promise<{ default: MessageRenderer }>;
}

const definitions = new Map<string, RendererDefinition>();
const aliasToKey = new Map<string, string>();

function structurallyEqual(a: RendererDefinition, b: RendererDefinition): boolean {
  return JSON.stringify(serializeDefinition(a)) === JSON.stringify(serializeDefinition(b));
}

function serializeDefinition(def: RendererDefinition): unknown {
  return {
    key: def.key,
    aliases: def.aliases ?? null,
    toolNamePatterns: (def.toolNamePatterns ?? []).map((p) =>
      p instanceof RegExp ? `re:${p.source}::${p.flags}` : `s:${p}`,
    ),
    configSchema: def.configSchema ?? null,
    hasTool: Boolean(def.tool),
    hasApproval: Boolean(def.approval),
    hasMessage: Boolean(def.message),
    hasMatcher: Boolean(def.matchMessage),
  };
}

export function registerRenderer(def: RendererDefinition): void {
  const existing = definitions.get(def.key);
  if (existing) {
    if (structurallyEqual(existing, def)) return;
    throw new Error(`Renderer key '${def.key}' is already registered with a different definition`);
  }
  for (const alias of def.aliases ?? []) {
    const claimed = aliasToKey.get(alias);
    if (claimed && claimed !== def.key) {
      throw new Error(
        `Renderer alias '${alias}' is already mapped to '${claimed}', cannot remap to '${def.key}'`,
      );
    }
  }
  definitions.set(def.key, def);
  for (const alias of def.aliases ?? []) {
    aliasToKey.set(alias, def.key);
  }
}

export function unregisterRenderer(key: string): void {
  const def = definitions.get(key);
  if (!def) return;
  for (const alias of def.aliases ?? []) {
    if (aliasToKey.get(alias) === key) aliasToKey.delete(alias);
  }
  definitions.delete(key);
}

export function clearRegistry(): void {
  definitions.clear();
  aliasToKey.clear();
}

export function getRendererByKey(key: string): RendererDefinition | undefined {
  const direct = definitions.get(key);
  if (direct) return direct;
  const canonical = aliasToKey.get(key);
  return canonical ? definitions.get(canonical) : undefined;
}

function matchesPattern(toolName: string, patterns: (string | RegExp)[] | undefined): boolean {
  if (!patterns) return false;
  for (const pattern of patterns) {
    if (typeof pattern === "string") {
      if (pattern === toolName) return true;
    } else if (pattern.test(toolName)) {
      return true;
    }
  }
  return false;
}

function findByToolName(
  toolName: string,
  filter: (def: RendererDefinition) => boolean,
): RendererDefinition | undefined {
  // First match wins in registration order: built-ins register first and own shared patterns,
  // plugins register after to claim only patterns built-ins don't already cover.
  for (const def of definitions.values()) {
    if (!filter(def)) continue;
    if (matchesPattern(toolName, def.toolNamePatterns)) return def;
  }
  return undefined;
}

export function getToolRenderer(
  key?: string,
  toolName?: string,
): RendererDefinition | undefined {
  if (key) {
    const byKey = getRendererByKey(key);
    if (byKey?.tool) return byKey;
  }
  if (toolName) return findByToolName(toolName, (d) => Boolean(d.tool));
  return undefined;
}

export function getApprovalRenderer(
  key?: string,
  toolName?: string,
): RendererDefinition | undefined {
  if (key) {
    const byKey = getRendererByKey(key);
    if (byKey?.approval) return byKey;
  }
  if (toolName) return findByToolName(toolName, (d) => Boolean(d.approval));
  return undefined;
}

export function getMessageRenderer(key: string): RendererDefinition | undefined {
  const def = getRendererByKey(key);
  return def?.message ? def : undefined;
}

export function listMessageMatchers(): RendererDefinition[] {
  const out: RendererDefinition[] = [];
  for (const def of definitions.values()) {
    if (def.message && def.matchMessage) out.push(def);
  }
  return out;
}

export function listRegisteredKeys(): string[] {
  return Array.from(definitions.keys());
}
