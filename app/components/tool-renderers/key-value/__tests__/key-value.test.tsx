import { describe, expect, it, vi } from "vitest";
import * as React from "react";

(globalThis as { React?: typeof React }).React = React;

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const value = typeof initial === "function" ? (initial as () => T)() : initial;
      return [value, vi.fn()] as const;
    },
    useMemo: <T,>(factory: () => T) => factory(),
    useCallback: <T extends (...args: never[]) => unknown>(cb: T) => cb,
    useRef: <T,>(initial: T) => ({ current: initial }),
    useEffect: () => undefined,
  };
});

import type { ToolRendererProps } from "@/lib/renderers/types";
import type { ToolCallPayload } from "@/lib/types/chat";
import { KeyValueRenderer } from "../KeyValueRenderer";

interface AnyElement {
  type: unknown;
  props: Record<string, unknown> | null;
}

function isElement(value: unknown): value is AnyElement {
  return Boolean(
    value
      && typeof value === "object"
      && "type" in (value as object)
      && "props" in (value as object),
  );
}

function walk(node: unknown, visit: (n: AnyElement) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (!isElement(node)) return;
  visit(node);
  walk((node.props ?? {}).children, visit);
}

function findByTestId(root: unknown, id: string): AnyElement | null {
  let match: AnyElement | null = null;
  walk(root, (n) => {
    if (match) return;
    if ((n.props ?? {})["data-testid"] === id) match = n;
  });
  return match;
}

function findAllByPrefix(root: unknown, prefix: string): AnyElement[] {
  const out: AnyElement[] = [];
  walk(root, (n) => {
    const id = (n.props ?? {})["data-testid"];
    if (typeof id === "string" && id.startsWith(prefix)) out.push(n);
  });
  return out;
}

function getText(node: unknown): string {
  let text = "";
  const collect = (value: unknown): void => {
    if (value === null || value === undefined || value === false || value === true) return;
    if (typeof value === "string") {
      text += value;
      return;
    }
    if (typeof value === "number") {
      text += String(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const v of value) collect(v);
      return;
    }
    if (isElement(value)) {
      collect((value.props ?? {}).children);
    }
  };
  collect(node);
  return text;
}

function makeToolCall(): ToolCallPayload {
  return {
    id: "tc-1",
    toolName: "anything",
    toolArgs: {},
    isCompleted: true,
  };
}

function render(props: Partial<ToolRendererProps> = {}): unknown {
  return (KeyValueRenderer as unknown as (p: ToolRendererProps) => unknown)({
    toolCall: props.toolCall ?? makeToolCall(),
    config: props.config,
    chatId: props.chatId,
  });
}

describe("KeyValueRenderer", () => {
  it("renders explicit rows array", () => {
    const tree = render({
      config: {
        rows: [
          { label: "host", value: "localhost" },
          { label: "port", value: 5432 },
        ],
      },
    });
    expect(findAllByPrefix(tree, "key-value-row-")).toHaveLength(2);
  });

  it("falls back to config keys when rows missing", () => {
    const tree = render({
      config: { foo: "bar", count: 7 },
    });
    expect(findAllByPrefix(tree, "key-value-row-")).toHaveLength(2);
  });

  it("renders empty state with no data", () => {
    const tree = render({});
    expect(findByTestId(tree, "key-value-empty")).not.toBeNull();
  });

  it("renders title when provided", () => {
    const tree = render({
      config: { title: "Connection", rows: [{ label: "a", value: 1 }] },
    });
    expect(getText(findByTestId(tree, "key-value-title"))).toBe("Connection");
  });

  it("stringifies non-string values", () => {
    const tree = render({
      config: { rows: [{ label: "obj", value: { a: 1 } }] },
    });
    const row = findByTestId(tree, "key-value-row-0");
    expect(getText(row)).toContain("\"a\"");
  });
});
