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

vi.mock("@/hooks/use-resolved-theme", () => ({
  useResolvedTheme: () => "light",
}));

vi.mock("prism-react-renderer", () => ({
  Highlight: ({
    code,
    children,
  }: {
    code: string;
    language: string;
    theme: unknown;
    children: (props: {
      className: string;
      style: Record<string, unknown>;
      tokens: { content: string; types: string[] }[][];
      getLineProps: (input: { line: unknown }) => Record<string, unknown>;
      getTokenProps: (input: { token: unknown }) => Record<string, unknown>;
    }) => unknown;
  }) => {
    const tokens = code.split("\n").map((ln) => [{ content: ln, types: ["plain"] }]);
    return children({
      className: "prism-mock",
      style: {},
      tokens,
      getLineProps: () => ({}),
      getTokenProps: ({ token }) => ({ children: (token as { content: string }).content }),
    });
  },
  themes: { vsDark: {}, vsLight: {} },
}));

import type { ToolRendererProps } from "@/lib/renderers/types";
import type { ToolCallPayload } from "@/lib/types/chat";
import { FileReadRenderer } from "../FileReadRenderer";

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

const EXPANDABLE_FN_NAMES = new Set(["CopyButton"]);

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
    toolName: "read_file",
    toolArgs: { path: "src/foo.ts" },
    isCompleted: true,
    ...overrides,
  };
}

function render(props: Partial<ToolRendererProps> = {}): unknown {
  return (FileReadRenderer as unknown as (p: ToolRendererProps) => unknown)({
    toolCall: props.toolCall ?? makeToolCall(),
    config: props.config,
    chatId: props.chatId,
  });
}

describe("FileReadRenderer", () => {
  it("renders path, line count, and code area", () => {
    const tree = render({
      toolCall: makeToolCall({
        toolArgs: { path: "src/foo.ts" },
        toolResult: "const a = 1;\nconst b = 2;",
      }),
    });
    expect(findByTestId(tree, "file-read-renderer")).not.toBeNull();
    const path = findByTestId(tree, "file-read-path");
    expect(getText(path)).toBe("src/foo.ts");
    const lc = findByTestId(tree, "file-read-line-count");
    expect(getText(lc)).toContain("2");
    expect(findByTestId(tree, "file-read-code")).not.toBeNull();
  });

  it("renders empty file state when content is empty", () => {
    const tree = render({
      toolCall: makeToolCall({ toolResult: "" }),
      config: { content: "" },
    });
    expect(findByTestId(tree, "file-read-empty")).not.toBeNull();
    expect(findByTestId(tree, "file-read-code")).toBeNull();
  });

  it("shows line range pill when startLine/endLine present", () => {
    const tree = render({
      config: { content: "x", startLine: 10, endLine: 20 },
    });
    const pill = findByTestId(tree, "file-read-line-range");
    expect(pill).not.toBeNull();
    expect(getText(pill)).toBe("L10-20");
  });

  it("uses config.path when toolArgs missing", () => {
    const tree = render({
      toolCall: makeToolCall({ toolArgs: {} }),
      config: { path: "lib/x.py", content: "print('hi')" },
    });
    expect(getText(findByTestId(tree, "file-read-path"))).toBe("lib/x.py");
  });
});
