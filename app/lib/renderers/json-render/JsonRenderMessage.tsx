"use client";

import type { MessageRenderer } from "@/lib/renderers";
import { defaultJsonRenderRegistry } from "./components";
import { Renderer, isValidSpec } from "./engine";

const JsonRenderMessage: MessageRenderer = ({ config }) => {
  const raw = typeof config.raw === "string" ? config.raw : "";

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return (
      <pre className="text-destructive text-xs" data-testid="json-render-parse-error">
        Invalid json-render JSON
      </pre>
    );
  }

  if (!isValidSpec(parsed)) {
    return (
      <pre className="text-destructive text-xs" data-testid="json-render-spec-error">
        Invalid json-render spec
      </pre>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-xl border bg-card/50 p-3"
      data-testid="json-render-root"
    >
      <Renderer spec={parsed} registry={defaultJsonRenderRegistry} />
    </div>
  );
};

export default JsonRenderMessage;
