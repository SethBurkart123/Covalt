
import type { ReactNode } from "react";
import type { MessageRenderer } from "@/lib/renderers";
import { defaultJsonRenderRegistry } from "./components";
import {
  Renderer,
  isValidSpec,
  type ComponentRegistry,
  type Spec,
} from "./engine";

const JsonRenderMessage: MessageRenderer = ({ config }) => {
  const raw = typeof config.raw === "string" ? config.raw : "";

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return renderJsonRenderFailed({
      reason: `Invalid JSON: ${getErrorMessage(error)}`,
      detail: getParseContext(raw, error),
    });
  }

  if (!isValidSpec(parsed)) return renderJsonRenderFailed({ reason: "Invalid spec" });

  const validation = validateRenderableSpec(parsed, defaultJsonRenderRegistry);
  if (!validation.ok) return renderJsonRenderFailed({ reason: validation.reason });

  return (
    <div className="not-prose my-2" data-testid="json-render-root">
      <Renderer spec={parsed} registry={defaultJsonRenderRegistry} />
    </div>
  );
};

interface RenderableSpecValidation {
  ok: boolean;
  reason: string;
}

function validateRenderableSpec(
  spec: Spec,
  registry: ComponentRegistry,
): RenderableSpecValidation {
  return validateRenderableElement(spec.root, spec, registry, new Set<string>());
}

function validateRenderableElement(
  id: string,
  spec: Spec,
  registry: ComponentRegistry,
  ancestors: Set<string>,
): RenderableSpecValidation {
  if (ancestors.has(id)) return { ok: false, reason: `Cycle at "${id}"` };
  const def = spec.elements[id];
  if (!def) return { ok: false, reason: `Missing element "${id}"` };
  if (!registry[def.type]) {
    return { ok: false, reason: `Unknown component "${def.type}"` };
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(id);
  for (const childId of def.children ?? []) {
    const validation = validateRenderableElement(childId, spec, registry, nextAncestors);
    if (!validation.ok) return validation;
  }
  return { ok: true, reason: "" };
}

interface JsonRenderFailedProps {
  reason: string;
  detail?: string;
}

function renderJsonRenderFailed({
  reason,
  detail,
}: JsonRenderFailedProps): ReactNode {
  return (
    <div
      className="not-prose my-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
      data-testid="json-render-failed"
    >
      <div>json-render failed: {reason}</div>
      {detail ? (
        <pre
          className="mt-2 whitespace-pre-wrap break-all rounded bg-background/60 p-2 font-mono text-[11px] leading-snug text-destructive/90"
          data-testid="json-render-failed-detail"
        >
          {detail}
        </pre>
      ) : null}
    </div>
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Unable to parse payload";
}

function getParseContext(raw: string, error: unknown): string | undefined {
  const message = getErrorMessage(error);
  const match = /position\s+(\d+)/i.exec(message);
  if (!match) return undefined;

  const position = Number(match[1]);
  if (!Number.isFinite(position)) return undefined;

  const start = Math.max(0, position - 80);
  const end = Math.min(raw.length, position + 80);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < raw.length ? "..." : "";
  const excerpt = `${prefix}${raw.slice(start, end)}${suffix}`;
  const caretOffset = prefix.length + position - start;
  return `${excerpt}\n${" ".repeat(Math.max(0, caretOffset))}^`;
}

export default JsonRenderMessage;
