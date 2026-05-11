import { describe, expect, it, vi } from "vitest";
import * as React from "react";

(globalThis as { React?: typeof React }).React = React;

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useMemo: <T,>(factory: () => T) => factory(),
  };
});

import { TodoListRenderer } from "../TodoListRenderer";

interface AnyElement {
  type: unknown;
  props: Record<string, unknown> | null;
}

function isElement(value: unknown): value is AnyElement {
  return Boolean(
    value && typeof value === "object" && "type" in (value as object) && "props" in (value as object),
  );
}

function walk(node: unknown, visit: (node: AnyElement) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (!isElement(node)) return;
  visit(node);
  const props = (node.props ?? {}) as Record<string, unknown>;
  walk(props.children, visit);
  if (typeof node.type === "function") {
    try {
      walk((node.type as (p: unknown) => unknown)(props), visit);
    } catch {
      // best-effort
    }
  }
}

function findAllByTestIdPrefix(root: unknown, prefix: string): AnyElement[] {
  const out: AnyElement[] = [];
  walk(root, (node) => {
    const id = node.props?.["data-testid"];
    if (typeof id === "string" && id.startsWith(prefix)) out.push(node);
  });
  return out;
}

describe("TodoListRenderer", () => {
  it("parses Droid TodoWrite progress markdown", () => {
    const tree = (TodoListRenderer as unknown as (p: unknown) => unknown)({
      id: "todo-1",
      toolName: "TodoWrite",
      toolArgs: {},
      isCompleted: false,
      progress: [{
        kind: "status",
        detail: '```json\n{"todos":"1. [in_progress] Fix renderer\\n2. [pending] Verify"}\n```',
      }],
    });

    const ids = new Set(
      findAllByTestIdPrefix(tree, "todo-item-").map((node) => node.props?.["data-testid"]),
    );
    expect(ids).toEqual(new Set(["todo-item-0", "todo-item-1"]));
  });
});
