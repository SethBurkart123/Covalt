import { beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";

(globalThis as { React?: typeof React }).React = React;

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const stateStore = new Map<number, unknown>();
  let stateIndex = 0;
  return {
    ...actual,
    __resetTestState: () => {
      stateStore.clear();
      stateIndex = 0;
    },
    __beginRender: () => {
      stateIndex = 0;
    },
    useState: <T,>(initial: T | (() => T)) => {
      const slot = stateIndex;
      stateIndex += 1;
      if (!stateStore.has(slot)) {
        const seed = typeof initial === "function" ? (initial as () => T)() : initial;
        stateStore.set(slot, seed);
      }
      const value = stateStore.get(slot) as T;
      const setter = vi.fn((next: T | ((prev: T) => T)) => {
        const prev = stateStore.get(slot) as T;
        const resolved =
          typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        stateStore.set(slot, resolved);
      });
      return [value, setter] as const;
    },
    useMemo: <T,>(factory: () => T) => factory(),
    useCallback: <T extends (...args: never[]) => unknown>(cb: T) => cb,
    useRef: <T,>(initial: T) => ({ current: initial }),
    useEffect: () => undefined,
  };
});

import type {
  ApprovalOutcome,
  ApprovalRendererProps,
  ApprovalRequest,
} from "@/lib/renderers";
import { getRendererByKey } from "@/lib/renderers";
import "@/lib/tool-renderers/registry";
import { TerminalApproval } from "../TerminalApproval";

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

const EXPANDABLE_FN_NAMES = new Set([
  "DefaultApproval",
  "ArgumentsDisplay",
  "QuestionField",
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
  walkChildren(props.rightContent, visit);
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

async function beginRender() {
  const reactMock = (await import("react")) as unknown as {
    __beginRender?: () => void;
  };
  reactMock.__beginRender?.();
}

function makeRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    toolCallId: "tool-1",
    runId: "run-1",
    kind: "tool_approval",
    options: [
      { value: "allow_once", label: "Approve", role: "allow_once" },
      { value: "deny", label: "Deny", role: "deny" },
    ],
    questions: [],
    editable: [
      { path: ["command"], schema: { type: "string", format: "multiline" }, label: "Command" },
    ],
    config: { toolArgs: { command: "ls -la" } },
    ...overrides,
  };
}

function mockResolve() {
  return vi.fn<(o: ApprovalOutcome) => Promise<void>>(async () => {});
}

function renderApproval(props: Partial<ApprovalRendererProps> = {}): unknown {
  const request = props.request ?? makeRequest();
  const onResolve = props.onResolve ?? mockResolve();
  const isPending = props.isPending ?? true;
  return (TerminalApproval as unknown as (p: ApprovalRendererProps) => unknown)({
    request,
    isPending,
    onResolve,
  });
}

beforeEach(async () => {
  const reactMock = (await import("react")) as unknown as {
    __resetTestState?: () => void;
    __beginRender?: () => void;
  };
  reactMock.__resetTestState?.();
  reactMock.__beginRender?.();
});

describe("TerminalApproval - approve outcome", () => {
  it("sends NO editedArgs when command unchanged", async () => {
    const onResolve = mockResolve();
    const tree = renderApproval({ onResolve });
    const allow = findByTestId(tree, "approval-option-allow_once");
    const onClick = (allow?.props as Record<string, unknown>).onClick as () => Promise<void>;
    await onClick();
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve.mock.calls[0][0].editedArgs).toBeUndefined();
  });

  it("sends editedArgs with new command when user changes value", async () => {
    const onResolve = mockResolve();
    await beginRender();
    const tree = renderApproval({ onResolve });
    const field = findByTestId(tree, "arg-input-command");
    const onChange = (field?.props as Record<string, unknown>).onChange as (
      e: { target: { value: string } },
    ) => void;
    onChange({ target: { value: "ls -lah" } });

    await beginRender();
    const tree2 = renderApproval({ onResolve });
    const allow = findByTestId(tree2, "approval-option-allow_once");
    const onClick = (allow?.props as Record<string, unknown>).onClick as () => Promise<void>;
    await onClick();
    expect(onResolve).toHaveBeenCalled();
    const last = onResolve.mock.calls[onResolve.mock.calls.length - 1][0];
    expect(last.editedArgs).toEqual({ command: "ls -lah" });
  });
});

describe("TerminalApproval - deny", () => {
  it("Deny sends selectedOption=deny with no editedArgs", async () => {
    const onResolve = mockResolve();
    const tree = renderApproval({ onResolve });
    const deny = findByTestId(tree, "approval-option-deny");
    const onClick = (deny?.props as Record<string, unknown>).onClick as () => Promise<void>;
    await onClick();
    expect(onResolve).toHaveBeenCalledTimes(1);
    const outcome = onResolve.mock.calls[0][0];
    expect(outcome.selectedOption).toBe("deny");
    expect(outcome.editedArgs).toBeUndefined();
  });
});

describe("registry - terminal key", () => {
  it("registers terminal key with both tool and approval roles", () => {
    const def = getRendererByKey("terminal");
    expect(def).toBeDefined();
    expect(def?.tool).toBeDefined();
    expect(def?.approval).toBeDefined();
  });
});
