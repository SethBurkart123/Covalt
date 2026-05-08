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
import { TodoListRenderer } from "../TodoListRenderer";

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

const EXPANDABLE_FN_NAMES = new Set(["TodoRow"]);

function walk(node: unknown, visit: (n: AnyElement) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (!isElement(node)) return;
  visit(node);
  const props = (node.props ?? {}) as Record<string, unknown>;
  walk(props.children, visit);
  if (typeof node.type === "function") {
    const name = (node.type as { name?: string }).name;
    if (name && EXPANDABLE_FN_NAMES.has(name)) {
      try {
        const rendered = (node.type as (p: unknown) => unknown)(props);
        walk(rendered, visit);
      } catch {
        // best-effort
      }
    }
  }
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

function makeToolCall(overrides: Partial<ToolCallPayload> = {}): ToolCallPayload {
  return {
    id: "tc-1",
    toolName: "todo_write",
    toolArgs: {},
    isCompleted: true,
    ...overrides,
  };
}

function render(props: Partial<ToolRendererProps> = {}): unknown {
  return (TodoListRenderer as unknown as (p: ToolRendererProps) => unknown)({
    toolCall: props.toolCall ?? makeToolCall(),
    config: props.config,
    chatId: props.chatId,
  });
}

describe("TodoListRenderer", () => {
  it("renders all todos with correct status icons", () => {
    const tree = render({
      config: {
        todos: [
          { content: "first", status: "completed" },
          { content: "second", status: "in_progress" },
          { content: "third", status: "pending" },
        ],
      },
    });
    expect(findAllByPrefix(tree, "todo-item-")).toHaveLength(3);
    expect(findByTestId(tree, "todo-icon-completed-0")).not.toBeNull();
    expect(findByTestId(tree, "todo-icon-in-progress-1")).not.toBeNull();
    expect(findByTestId(tree, "todo-icon-pending-2")).not.toBeNull();
  });

  it("renders empty state with no todos", () => {
    const tree = render();
    expect(findByTestId(tree, "todo-list-empty")).not.toBeNull();
    expect(findByTestId(tree, "todo-list-items")).toBeNull();
  });

  it("counts reflect status distribution", () => {
    const tree = render({
      config: {
        todos: [
          { content: "a", status: "completed" },
          { content: "b", status: "completed" },
          { content: "c", status: "in_progress" },
          { content: "d", status: "pending" },
          { content: "e", status: "pending" },
        ],
      },
    });
    const counts = findByTestId(tree, "todo-list-counts");
    expect(counts).not.toBeNull();
    const text = getText(counts);
    expect(text).toContain("2 done");
    expect(text).toContain("1 in progress");
    expect(text).toContain("2 pending");
  });

  it("falls back to toolArgs.todos", () => {
    const tree = render({
      toolCall: makeToolCall({
        toolArgs: { todos: [{ content: "from args", status: "pending" }] },
      }),
    });
    expect(findByTestId(tree, "todo-item-0")).not.toBeNull();
  });
});
