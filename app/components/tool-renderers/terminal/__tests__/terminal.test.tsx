import { describe, expect, it, vi, beforeEach } from "vitest";
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
  ToolRendererProps,
} from "@/lib/renderers";
import { getRendererByKey } from "@/lib/renderers";
import "@/lib/tool-renderers/registry";
import { TerminalRenderer } from "../TerminalRenderer";
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

const EXPANDABLE_FN_NAMES = new Set(["RiskPill", "ExitPill"]);

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

function makeToolCall(overrides: Record<string, unknown> = {}) {
  return {
    id: "tc-1",
    toolName: "bash",
    toolArgs: {},
    isCompleted: false,
    ...overrides,
  };
}

async function beginRender() {
  const reactMock = (await import("react")) as unknown as {
    __beginRender?: () => void;
  };
  reactMock.__beginRender?.();
}

function renderTool(props: Partial<ToolRendererProps> = {}): unknown {
  const toolCall = (props.toolCall ?? makeToolCall()) as ToolRendererProps["toolCall"];
  return (TerminalRenderer as unknown as (p: ToolRendererProps) => unknown)({
    toolCall,
    config: props.config,
    chatId: props.chatId,
  });
}

function makeRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    requestId: "req-1",
    runId: "run-1",
    kind: "tool_approval",
    options: [
      { value: "allow_once", label: "Approve", role: "allow_once" },
      { value: "deny", label: "Deny", role: "deny" },
    ],
    questions: [],
    editable: [],
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

describe("TerminalRenderer - command resolution", () => {
  it("renders command from config.command", () => {
    const tree = renderTool({
      toolCall: makeToolCall(),
      config: { command: "echo hi" },
    });
    const cmd = findByTestId(tree, "terminal-command");
    expect(cmd).not.toBeNull();
    const children = (cmd?.props as Record<string, unknown>).children;
    expect(String(children).includes("echo hi")).toBe(true);
  });

  it("falls back to toolArgs.command when config missing", () => {
    const tree = renderTool({
      toolCall: makeToolCall({ toolArgs: { command: "pwd" } }),
    });
    const cmd = findByTestId(tree, "terminal-command");
    const children = (cmd?.props as Record<string, unknown>).children;
    expect(String(children).includes("pwd")).toBe(true);
  });

  it("shows '(no command)' placeholder when nothing supplied", () => {
    const tree = renderTool({ toolCall: makeToolCall() });
    const cmd = findByTestId(tree, "terminal-command");
    const children = (cmd?.props as Record<string, unknown>).children;
    expect(String(children)).toBe("(no command)");
  });
});

describe("TerminalRenderer - exit pill", () => {
  it("shows exit pill with exitCode from config", () => {
    const tree = renderTool({
      toolCall: makeToolCall({ isCompleted: true }),
      config: { command: "ls", exitCode: 0 },
    });
    const pill = findByTestId(tree, "terminal-exit-pill");
    expect(pill).not.toBeNull();
    expect((pill?.props as Record<string, unknown>)["data-exit-state"]).toBe("success");
  });

  it("shows error-state pill for non-zero exit", () => {
    const tree = renderTool({
      toolCall: makeToolCall({ isCompleted: true }),
      config: { command: "false", exitCode: 1 },
    });
    const pill = findByTestId(tree, "terminal-exit-pill");
    expect((pill?.props as Record<string, unknown>)["data-exit-state"]).toBe("error");
  });
});

describe("TerminalRenderer - copy output", () => {
  it("copy-output button calls navigator.clipboard.writeText", () => {
    const writeText = vi.fn();
    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { writeText } },
      configurable: true,
    });
    const tree = renderTool({
      toolCall: makeToolCall({ isCompleted: true }),
      config: { command: "echo hello", output: "hello\n", exitCode: 0 },
    });
    const btn = findByTestId(tree, "terminal-copy-output");
    const onClick = (btn?.props as Record<string, unknown>).onClick as () => void;
    onClick();
    expect(writeText).toHaveBeenCalledWith("hello\n");
  });
});

describe("TerminalApproval - command field", () => {
  it("renders editable command field pre-filled from request.config.toolArgs.command", () => {
    const tree = renderApproval();
    const field = findByTestId(tree, "terminal-approval-command");
    expect(field).not.toBeNull();
    expect((field?.props as Record<string, unknown>).value).toBe("ls -la");
  });
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
    const field = findByTestId(tree, "terminal-approval-command");
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
