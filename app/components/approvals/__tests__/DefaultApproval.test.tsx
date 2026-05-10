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

import type {
  ApprovalOutcome,
  ApprovalRendererProps,
  ApprovalRequest,
} from "@/lib/renderers";
import { DefaultApproval } from "../DefaultApproval";

type ResolveMock = (outcome: ApprovalOutcome) => Promise<void>;

function mockResolve() {
  return vi.fn<ResolveMock>(async () => {});
}

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
  "RiskPill",
  "ToolArgsPreview",
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

function findAllByTestIdPrefix(root: unknown, prefix: string): AnyElement[] {
  const out: AnyElement[] = [];
  walkChildren(root, (n) => {
    const props = (n.props ?? {}) as Record<string, unknown>;
    const id = props["data-testid"];
    if (typeof id === "string" && id.startsWith(prefix)) out.push(n);
  });
  return out;
}

function makeRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    requestId: "req-1",
    runId: "run-1",
    kind: "tool_approval",
    options: [
      { value: "allow_once", label: "Allow", role: "allow_once" },
      { value: "deny", label: "Deny", role: "deny" },
    ],
    questions: [],
    editable: [],
    ...overrides,
  };
}

function render(props: Partial<ApprovalRendererProps> = {}): unknown {
  const request = props.request ?? makeRequest();
  const onResolve = props.onResolve ?? mockResolve();
  const isPending = props.isPending ?? true;
  return (DefaultApproval as unknown as (p: ApprovalRendererProps) => unknown)({
    request,
    isPending,
    onResolve,
  });
}

describe("DefaultApproval - basic approve/deny", () => {
  it("renders Allow and Deny buttons", () => {
    const tree = render();
    const allow = findByTestId(tree, "approval-option-allow_once");
    const deny = findByTestId(tree, "approval-option-deny");
    expect(allow).not.toBeNull();
    expect(deny).not.toBeNull();
  });

  it("clicking Allow invokes onResolve with selectedOption=allow_once", async () => {
    const onResolve = mockResolve();
    const tree = render({ onResolve });
    const allow = findByTestId(tree, "approval-option-allow_once");
    const onClick = (allow?.props as Record<string, unknown> | null)?.onClick as
      | (() => Promise<void>)
      | undefined;
    expect(typeof onClick).toBe("function");
    await onClick!();
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve.mock.calls[0][0]).toMatchObject({ selectedOption: "allow_once" });
  });

  it("clicking Deny invokes onResolve with selectedOption=deny", async () => {
    const onResolve = mockResolve();
    const tree = render({ onResolve });
    const deny = findByTestId(tree, "approval-option-deny");
    const onClick = (deny?.props as Record<string, unknown> | null)?.onClick as
      | (() => Promise<void>)
      | undefined;
    await onClick!();
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve.mock.calls[0][0]).toMatchObject({ selectedOption: "deny" });
  });
});

describe("DefaultApproval - multi-option", () => {
  it("renders one button per option, regardless of count", () => {
    const tree = render({
      request: makeRequest({
        options: [
          { value: "allow_once", label: "Once", role: "allow_once" },
          { value: "allow_session", label: "Session", role: "allow_session" },
          { value: "allow_always", label: "Always", role: "allow_always" },
          { value: "deny", label: "Deny", role: "deny" },
        ],
      }),
    });
    const buttons = findAllByTestIdPrefix(tree, "approval-option-");
    expect(buttons).toHaveLength(4);
  });

  it("each option button submits its own value", async () => {
    const onResolve = mockResolve();
    const tree = render({
      request: makeRequest({
        options: [
          { value: "allow_session", label: "Session", role: "allow_session" },
          { value: "deny", label: "Deny", role: "deny" },
        ],
      }),
      onResolve,
    });
    const session = findByTestId(tree, "approval-option-allow_session");
    const onClick = (session?.props as Record<string, unknown>).onClick as () => Promise<void>;
    await onClick();
    expect(onResolve.mock.calls[0][0].selectedOption).toBe("allow_session");
  });
});

describe("DefaultApproval - questions form", () => {
  const request = makeRequest({
    kind: "user_input",
    options: [{ value: "submit", label: "Submit", role: "custom", requiresInput: true }],
    questions: [
      { index: 0, topic: "reason", question: "Why?", required: true },
    ],
  });

  it("disables requires_input option until questions are filled", () => {
    const tree = render({ request });
    const submit = findByTestId(tree, "approval-option-submit");
    expect((submit?.props as Record<string, unknown>).disabled).toBe(true);
  });

  it("submits answers in selected outcome", async () => {
    const onResolve = mockResolve();
    const tree = render({ request, onResolve });
    const submit = findByTestId(tree, "approval-option-submit");
    const onClick = (submit?.props as Record<string, unknown>).onClick as () => Promise<void>;
    await onClick();
    expect(onResolve.mock.calls[0][0].answers).toEqual([
      { index: 0, answer: "" },
    ]);
  });
});

describe("DefaultApproval - editable form", () => {
  const request = makeRequest({
    editable: [
      { path: ["target"], schema: { type: "string" }, label: "Target" },
    ],
    config: { toolArgs: { target: "old", keep: 7 } },
  });

  it("renders inline editable input via ArgumentsDisplay", () => {
    const tree = render({ request });
    expect(findByTestId(tree, "arg-input-target")).not.toBeNull();
  });

  it("approve outcome carries unchanged editedArgs as undefined", async () => {
    const onResolve = mockResolve();
    const tree = render({ request, onResolve });
    const allow = findByTestId(tree, "approval-option-allow_once");
    const onClick = (allow?.props as Record<string, unknown>).onClick as () => Promise<void>;
    await onClick();
    expect(onResolve.mock.calls[0][0].editedArgs).toBeUndefined();
  });
});

describe("DefaultApproval - risk level pill", () => {
  it("renders danger-styled pill for high risk", () => {
    const tree = render({ request: makeRequest({ riskLevel: "high" }) });
    const pill = findByTestId(tree, "approval-risk-pill");
    expect(pill).not.toBeNull();
    expect((pill?.props as Record<string, unknown>)["data-risk-level"]).toBe("high");
  });

  it("does not render pill when risk_level missing", () => {
    const tree = render({ request: makeRequest() });
    const pill = findByTestId(tree, "approval-risk-pill");
    expect(pill).toBeNull();
  });
});

describe("DefaultApproval - pending state", () => {
  it("disables all option buttons when isPending=false", () => {
    const tree = render({ isPending: false });
    const buttons = findAllByTestIdPrefix(tree, "approval-option-");
    for (const b of buttons) {
      expect((b.props as Record<string, unknown>).disabled).toBe(true);
    }
  });
});

describe("DefaultApproval - tool args preview", () => {
  it("renders args preview when toolArgs present", () => {
    const tree = render({
      request: makeRequest({ config: { toolArgs: { foo: "bar" } } }),
    });
    expect(findByTestId(tree, "approval-tool-args")).not.toBeNull();
  });

  it("omits args preview when toolArgs absent", () => {
    const tree = render();
    expect(findByTestId(tree, "approval-tool-args")).toBeNull();
  });
});
