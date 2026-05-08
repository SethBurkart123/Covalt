import { describe, expect, it } from "vitest";
import * as React from "react";

(globalThis as { React?: typeof React }).React = React;

import type { MessageRendererProps } from "@/lib/renderers";
import JsonRenderMessage from "../JsonRenderMessage";

interface AnyElement {
  type: unknown;
  props: Record<string, unknown> | null;
}

function isElement(value: unknown): value is AnyElement {
  return Boolean(
    value &&
      typeof value === "object" &&
      "type" in (value as object) &&
      "props" in (value as object),
  );
}

function findByTestId(node: unknown, id: string): AnyElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByTestId(child, id);
      if (found) return found;
    }
    return null;
  }
  if (!isElement(node)) return null;
  const props = (node.props ?? {}) as Record<string, unknown>;
  if (props["data-testid"] === id) return node;
  return findByTestId(props.children, id);
}

function render(config: Record<string, unknown>): unknown {
  return (JsonRenderMessage as unknown as (p: MessageRendererProps) => unknown)({ config });
}

describe("JsonRenderMessage", () => {
  it("renders root element wrapper for valid spec", () => {
    const raw = JSON.stringify({
      root: "a",
      elements: { a: { type: "Text", props: { text: "hello" } } },
    });
    const tree = render({ raw });
    expect(findByTestId(tree, "json-render-root")).not.toBeNull();
  });

  it("renders parse-error pre when JSON is malformed", () => {
    const tree = render({ raw: "{not json" });
    expect(findByTestId(tree, "json-render-parse-error")).not.toBeNull();
  });

  it("renders spec-error pre when shape is invalid", () => {
    const tree = render({ raw: JSON.stringify({ no: "root" }) });
    expect(findByTestId(tree, "json-render-spec-error")).not.toBeNull();
  });

  it("treats missing raw as empty (parse error)", () => {
    const tree = render({});
    expect(findByTestId(tree, "json-render-parse-error")).not.toBeNull();
  });
});
