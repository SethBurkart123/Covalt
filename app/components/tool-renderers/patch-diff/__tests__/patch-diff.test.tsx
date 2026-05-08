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
  function MockReactDiffViewer(props: { oldValue: string; newValue: string }) {
    return {
      type: "div",
      props: {
        "data-testid": "react-diff-viewer-mock",
        "data-old": props.oldValue,
        "data-new": props.newValue,
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
import { PatchDiffRenderer } from "../PatchDiffRenderer";

interface AnyElement {
  type: unknown;
  props: Record<string, unknown> | null;
}

function isElement(value: unknown): value is AnyElement {
  return Boolean(
    value && typeof value === "object" && "type" in (value as object) && "props" in (value as object),
  );
}

const EXPANDABLE_FN_NAMES = new Set([
  "PatchSummary",
  "PatchFileSection",
]);

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

function findAllByTestId(root: unknown, testId: string): AnyElement[] {
  const out: AnyElement[] = [];
  walkChildren(root, (n) => {
    const props = (n.props ?? {}) as Record<string, unknown>;
    if (props["data-testid"] === testId) out.push(n);
  });
  return out;
}

function makeToolCall(overrides: Partial<ToolCallPayload> = {}): ToolCallPayload {
  return {
    id: "call-1",
    toolName: "apply_patch",
    toolArgs: {},
    isCompleted: true,
    ...overrides,
  };
}

function render(props: Partial<ToolRendererProps> = {}): unknown {
  const toolCall = props.toolCall ?? makeToolCall();
  return (PatchDiffRenderer as unknown as (p: ToolRendererProps) => unknown)({
    toolCall,
    config: props.config,
    chatId: props.chatId,
  });
}

const SAMPLE_PATCH = [
  "*** Begin Patch",
  "*** Update File: a.ts",
  "@@",
  "-old",
  "+new",
  "*** Update File: b.ts",
  "@@",
  "+only-added",
  "*** Add File: c.ts",
  "+brand new",
  "*** End Patch",
].join("\n");

describe("PatchDiffRenderer", () => {
  it("renders summary chip with file counts", () => {
    const tree = render({ config: { patch: SAMPLE_PATCH } });
    const summary = findByTestId(tree, "patch-summary");
    expect(summary).not.toBeNull();
    const text = ((summary?.props as Record<string, unknown>).children as string) ?? "";
    expect(text).toContain("3 files changed");
    expect(text).toContain("2 updated");
    expect(text).toContain("1 created");
  });

  it("renders one section per parsed file", () => {
    const tree = render({ config: { patch: SAMPLE_PATCH } });
    const sections = findAllByTestId(tree, "patch-file-section");
    expect(sections).toHaveLength(3);
    const paths = sections.map((s) => (s.props as Record<string, unknown>)["data-file-path"]);
    expect(paths).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("shows empty state for empty patch", () => {
    const tree = render({ config: { patch: "" } });
    const summary = findByTestId(tree, "patch-summary");
    expect(summary).toBeNull();
    const sections = findAllByTestId(tree, "patch-file-section");
    expect(sections).toHaveLength(0);
  });

  it("reads patch text from toolArgs.patch fallback", () => {
    const tree = render({
      toolCall: makeToolCall({ toolArgs: { patch: SAMPLE_PATCH } }),
    });
    expect(findAllByTestId(tree, "patch-file-section")).toHaveLength(3);
  });
});
