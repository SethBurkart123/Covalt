export const RENDERER_ALIAS_MAP: Record<string, string> = {
  markdown: "document",
};

export function normalizeRendererAlias(renderer?: string | null): string | undefined {
  if (!renderer) return undefined;
  return RENDERER_ALIAS_MAP[renderer] ?? renderer;
}

export interface ParsedToolId {
  kind: "blacklist" | "mcp_toolset" | "mcp_tool" | "toolset_all" | "toolset_tool" | "builtin";
  namespace?: string;
  name?: string;
}

export function parseToolId(toolId: string): ParsedToolId {
  if (toolId.startsWith("-")) {
    const inner = toolId.slice(1);
    if (inner.startsWith("mcp:")) {
      const parts = inner.split(":");
      if (parts.length >= 3) {
        return { kind: "blacklist", namespace: parts[1], name: parts.slice(2).join(":") };
      }
    }
    return { kind: "blacklist", name: inner };
  }

  if (toolId.startsWith("mcp:")) {
    const parts = toolId.split(":");
    if (parts.length === 2) {
      return { kind: "mcp_toolset", namespace: parts[1] };
    }
    if (parts.length >= 3) {
      return { kind: "mcp_tool", namespace: parts[1], name: parts.slice(2).join(":") };
    }
  }

  if (toolId.startsWith("toolset:")) {
    return { kind: "toolset_all", namespace: toolId.slice("toolset:".length) };
  }

  if (toolId.includes(":")) {
    const [namespace, ...rest] = toolId.split(":");
    return { kind: "toolset_tool", namespace, name: rest.join(":") };
  }

  return { kind: "builtin", name: toolId };
}

export function formatMcpToolId(serverKey: string, toolName: string): string {
  return `mcp:${serverKey}:${toolName}`;
}

export function splitMcpToolId(toolId: string): { serverKey: string; toolName: string } | null {
  const parsed = parseToolId(toolId);
  if (parsed.kind !== "mcp_tool" || !parsed.namespace || !parsed.name) {
    return null;
  }
  return { serverKey: parsed.namespace, toolName: parsed.name };
}

export function getToolDisplayLabel(toolId: string, fallbackName?: string | null): string {
  if (fallbackName) return fallbackName;
  const parsed = parseToolId(toolId);
  if (parsed.name) return parsed.name;
  return toolId;
}

export function parseToolDisplayParts(toolName: string): { label: string; namespace?: string } {
  if (!toolName.includes(":")) {
    return { label: toolName };
  }

  const [namespaceRaw, ...rest] = toolName.split(":");
  const namespace = namespaceRaw.includes("~")
    ? namespaceRaw.split("~").pop() || namespaceRaw
    : namespaceRaw;
  const label = rest.join(":") || toolName;
  return { label, namespace };
}
