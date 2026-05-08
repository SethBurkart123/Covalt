import { afterEach, describe, expect, it, vi } from "vitest";
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

import type { ApprovalRendererProps, ApprovalRequest } from "@/lib/renderers";
import { clearRegistry, registerRenderer } from "@/lib/renderers";
import { ApprovalRouter } from "../ApprovalRouter";
import { DefaultApproval } from "../DefaultApproval";

function makeRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    requestId: "req-1",
    runId: "run-1",
    kind: "tool_approval",
    options: [{ value: "allow_once", label: "Allow", role: "allow_once" }],
    questions: [],
    editable: [],
    ...overrides,
  };
}

function render(props: Partial<ApprovalRendererProps> = {}): unknown {
  const request = props.request ?? makeRequest();
  const onResolve = props.onResolve ?? (async () => {});
  const isPending = props.isPending ?? true;
  return (ApprovalRouter as unknown as (p: ApprovalRendererProps) => unknown)({
    request,
    isPending,
    onResolve,
  });
}

afterEach(() => {
  clearRegistry();
});

describe("ApprovalRouter", () => {
  it("renders DefaultApproval when no renderer key is set and no registry match", () => {
    const element = render() as { type?: unknown };
    expect(element?.type).toBe(DefaultApproval);
  });

  it("falls back to DefaultApproval when renderer key is unknown", () => {
    const element = render({
      request: makeRequest({ renderer: "does-not-exist" }),
    }) as { type?: unknown };
    expect(element?.type).toBe(DefaultApproval);
  });

  it("uses DefaultApproval immediately while custom renderer is loading", () => {
    const Custom = () => null;
    registerRenderer({
      key: "terminal",
      approval: () => new Promise(() => {}),
    });
    const element = render({
      request: makeRequest({ renderer: "terminal" }),
    }) as { type?: unknown };
    expect(element?.type).toBe(DefaultApproval);
    expect(element?.type).not.toBe(Custom);
  });

  it("looks up renderer when request.renderer is provided", () => {
    const approvalLoader = vi.fn(async () => ({ default: () => null }));
    registerRenderer({
      key: "custom",
      approval: approvalLoader,
    });
    const tree = render({ request: makeRequest({ renderer: "custom" }) });
    expect(tree).toBeTruthy();
  });
});
