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

vi.mock("react-diff-viewer-continued", () => {
  function MockReactDiffViewer(props: {
    oldValue: string;
    newValue: string;
    splitView?: boolean;
  }) {
    return {
      type: "div",
      props: {
        "data-testid": "react-diff-viewer-mock",
        "data-old": props.oldValue,
        "data-new": props.newValue,
        "data-split": props.splitView ? "true" : "false",
      },
    };
  }
  return { default: MockReactDiffViewer };
});

vi.mock("@/hooks/use-resolved-theme", () => ({
  useResolvedTheme: () => "light",
}));

import type { ToolCallPayload } from "@/lib/types/chat";
import type { ToolRendererProps } from "@/lib/renderers";
import { FileDiffRenderer } from "../FileDiffRenderer";
import { countDiffLines } from "../DiffView";

interface AnyElement {
  type: unknown;
  props: Record<string, unknown> | null;
}

function isElement(value: unknown): value is AnyElement {
  return Boolean(
    value && typeof value === "object" && "type" in (value as object) && "props" in (value as object),
  );
}

const EXPANDABLE_FN_NAMES = new Set(["DiffView", "MockReactDiffViewer"]);

function walkChildren(node: unknown, visit: (node: AnyElement) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walkChildren(child, visit);
    return;
  }
  if (!isElement(node)) return;
  visit(node);
  const props = (node.props ?? {}) as Record<string, unknown>;
  walkChildren(props.children, visit);
  if (typeof node.type === "function") {
    const name = (node.type as { name?: string }).name;
    if (name && EXPANDABLE_FN_NAMES.has(name)) {
      try {
        const rendered = (node.type as (p: unknown) => unknown)(props);
        walkChildren(rendered, visit);
      } catch {
        // best-effort
      }
    }
  }
}

function findByTestId(root: unknown, testId: string): AnyElement | null {
  let match: AnyElement | null = null;
  walkChildren(root, (n) => {
    if (match) return;
    const props = (n.props ?? {}) as Record<string, unknown>;
    if (props["data-testid"] === testId) match = n;
  });
  return match;
}

function makeToolCall(overrides: Partial<ToolCallPayload> = {}): ToolCallPayload {
  return {
    id: "call-1",
    toolName: "edit",
    toolArgs: {},
    isCompleted: true,
    ...overrides,
  };
}

function render(props: Partial<ToolRendererProps> = {}): unknown {
  const toolCall = props.toolCall ?? makeToolCall();
  return (FileDiffRenderer as unknown as (p: ToolRendererProps) => unknown)({
    toolCall,
    config: props.config,
    chatId: props.chatId,
  });
}

describe("countDiffLines", () => {
  it("counts simple replacement", () => {
    expect(countDiffLines("hello", "world")).toEqual({ additions: 1, deletions: 1 });
  });

  it("counts pure additions", () => {
    expect(countDiffLines("a", "a\nb")).toEqual({ additions: 1, deletions: 0 });
  });

  it("counts pure deletions", () => {
    expect(countDiffLines("a\nb", "a")).toEqual({ additions: 0, deletions: 1 });
  });

  it("returns zeros for identical text", () => {
    expect(countDiffLines("same", "same")).toEqual({ additions: 0, deletions: 0 });
  });

  it("returns zeros for empty inputs", () => {
    expect(countDiffLines("", "")).toEqual({ additions: 0, deletions: 0 });
  });
});

describe("FileDiffRenderer", () => {
  it("renders the file path from config", () => {
    const tree = render({
      config: { filePath: "src/foo.ts", oldContent: "a", newContent: "b" },
      toolCall: makeToolCall(),
    });
    const view = findByTestId(tree, "diff-view");
    expect(view).not.toBeNull();
    expect((view?.props as Record<string, unknown>)["data-file-path"]).toBe("src/foo.ts");
  });

  it("falls back to toolArgs.path when config missing", () => {
    const tree = render({
      toolCall: makeToolCall({ toolArgs: { path: "lib/bar.ts", old_str: "x", new_str: "y" } }),
    });
    const view = findByTestId(tree, "diff-view");
    expect((view?.props as Record<string, unknown>)["data-file-path"]).toBe("lib/bar.ts");
  });

  it("smoke-renders the diff viewer when content is present", () => {
    const tree = render({
      config: { filePath: "f.ts", oldContent: "old", newContent: "new" },
    });
    const viewer = findByTestId(tree, "react-diff-viewer-mock");
    expect(viewer).not.toBeNull();
    expect((viewer?.props as Record<string, unknown>)["data-old"]).toBe("old");
    expect((viewer?.props as Record<string, unknown>)["data-new"]).toBe("new");
  });

  it("renders empty state when no diff content available", () => {
    const tree = render({});
    const view = findByTestId(tree, "diff-view");
    expect(view).not.toBeNull();
    const viewer = findByTestId(tree, "react-diff-viewer-mock");
    expect(viewer).toBeNull();
  });

  it("uses partial-edit label for str_replace style edits", () => {
    const tree = render({
      toolCall: makeToolCall({
        toolName: "str_replace",
        toolArgs: { path: "p.ts", old_str: "x", new_str: "y" },
      }),
    });
    const viewer = findByTestId(tree, "react-diff-viewer-mock");
    expect((viewer?.props as Record<string, unknown>)["data-old"]).toBe("x");
    expect((viewer?.props as Record<string, unknown>)["data-new"]).toBe("y");
  });
});
