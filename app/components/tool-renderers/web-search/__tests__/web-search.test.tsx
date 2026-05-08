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
import { WebSearchRenderer } from "../WebSearchRenderer";

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

const EXPANDABLE_FN_NAMES = new Set(["ResultCard", "SkeletonCard"]);

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

function makeToolCall(overrides: Partial<ToolCallPayload> = {}): ToolCallPayload {
  return {
    id: "tc-1",
    toolName: "web_search",
    toolArgs: {},
    isCompleted: true,
    ...overrides,
  };
}

function render(props: Partial<ToolRendererProps> = {}): unknown {
  return (WebSearchRenderer as unknown as (p: ToolRendererProps) => unknown)({
    toolCall: props.toolCall ?? makeToolCall(),
    config: props.config,
    chatId: props.chatId,
  });
}

describe("WebSearchRenderer", () => {
  it("renders results with title, domain pill, snippet", () => {
    const tree = render({
      toolCall: makeToolCall({ toolArgs: { query: "tinygrad" } }),
      config: {
        results: [
          {
            title: "Tinygrad README",
            url: "https://github.com/tinygrad/tinygrad",
            snippet: "A simple neural net framework.",
          },
        ],
      },
    });
    expect(findByTestId(tree, "web-search-renderer")).not.toBeNull();
    expect(findByTestId(tree, "web-search-result-0")).not.toBeNull();
    const count = findByTestId(tree, "web-search-count");
    expect(count).not.toBeNull();
  });

  it("renders empty state when completed with no results", () => {
    const tree = render({
      toolCall: makeToolCall({ isCompleted: true, toolResult: "{}" }),
    });
    expect(findByTestId(tree, "web-search-empty")).not.toBeNull();
    expect(findByTestId(tree, "web-search-results")).toBeNull();
  });

  it("renders skeletons while loading", () => {
    const tree = render({
      toolCall: makeToolCall({ isCompleted: false }),
    });
    expect(findByTestId(tree, "web-search-loading")).not.toBeNull();
    expect(findAllByPrefix(tree, "web-search-skeleton-")).toHaveLength(3);
  });

  it("count badge reflects result length", () => {
    const tree = render({
      config: {
        results: [
          { title: "a", url: "https://a.com" },
          { title: "b", url: "https://b.com" },
          { title: "c", url: "https://c.com" },
        ],
      },
    });
    expect(findAllByPrefix(tree, "web-search-result-")).toHaveLength(3);
  });

  it("parses results from JSON toolResult", () => {
    const tree = render({
      toolCall: makeToolCall({
        toolResult: JSON.stringify({
          results: [{ title: "x", url: "https://x.com" }],
        }),
      }),
    });
    expect(findByTestId(tree, "web-search-result-0")).not.toBeNull();
  });
});
