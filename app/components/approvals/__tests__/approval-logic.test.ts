import { describe, expect, it } from "vitest";
import type { ApprovalOption, ApprovalRequest } from "@/lib/renderers";
import {
  buildInitialEdits,
  buildOutcome,
  buttonVariantFor,
  composeEditedArgs,
  isInputValid,
  pathKey,
} from "../approval-logic";

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

describe("buttonVariantFor", () => {
  it("maps deny role to destructive", () => {
    expect(buttonVariantFor({ value: "deny", label: "Deny", role: "deny" })).toBe("destructive");
  });

  it("maps abort role to destructive", () => {
    expect(buttonVariantFor({ value: "abort", label: "Abort", role: "abort" })).toBe("destructive");
  });

  it("maps allow_* roles to default", () => {
    expect(buttonVariantFor({ value: "a", label: "A", role: "allow_once" })).toBe("default");
    expect(buttonVariantFor({ value: "b", label: "B", role: "allow_session" })).toBe("default");
    expect(buttonVariantFor({ value: "c", label: "C", role: "allow_always" })).toBe("default");
  });

  it("respects explicit primary style", () => {
    expect(
      buttonVariantFor({ value: "x", label: "X", role: "custom", style: "primary" }),
    ).toBe("default");
  });

  it("respects explicit destructive style", () => {
    expect(
      buttonVariantFor({ value: "x", label: "X", role: "custom", style: "destructive" }),
    ).toBe("destructive");
  });

  it("falls back to outline for custom unstyled", () => {
    expect(buttonVariantFor({ value: "x", label: "X", role: "custom" })).toBe("outline");
  });
});

describe("isInputValid", () => {
  it("is valid with no questions and no editable", () => {
    expect(isInputValid(makeRequest(), {}, {})).toBe(true);
  });

  it("is invalid when a required question is empty", () => {
    const req = makeRequest({
      questions: [
        { index: 0, topic: "t", question: "Why?", required: true },
      ],
    });
    expect(isInputValid(req, {}, {})).toBe(false);
    expect(isInputValid(req, { 0: "" }, {})).toBe(false);
    expect(isInputValid(req, { 0: "  " }, {})).toBe(false);
  });

  it("is valid when required question is filled", () => {
    const req = makeRequest({
      questions: [
        { index: 0, topic: "t", question: "Why?", required: true },
      ],
    });
    expect(isInputValid(req, { 0: "because" }, {})).toBe(true);
  });

  it("ignores optional questions", () => {
    const req = makeRequest({
      questions: [{ index: 0, topic: "t", question: "Why?" }],
    });
    expect(isInputValid(req, {}, {})).toBe(true);
  });

  it("checks required editable fields", () => {
    const req = makeRequest({
      editable: [
        { path: ["name"], schema: { type: "string", required: true } },
      ],
    });
    expect(isInputValid(req, {}, { name: "" })).toBe(false);
    expect(isInputValid(req, {}, { name: "ok" })).toBe(true);
  });
});

describe("buildInitialEdits", () => {
  it("seeds from request.config.toolArgs by path", () => {
    const req = makeRequest({
      editable: [
        { path: ["foo", "bar"], schema: { type: "string" } },
        { path: ["count"], schema: { type: "number" } },
      ],
      config: { toolArgs: { foo: { bar: "hello" }, count: 5 } },
    });
    const seeded = buildInitialEdits(req);
    expect(seeded[pathKey(["foo", "bar"])]).toBe("hello");
    expect(seeded[pathKey(["count"])]).toBe(5);
  });

  it("uses defaults when toolArgs missing", () => {
    const req = makeRequest({
      editable: [
        { path: ["flag"], schema: { type: "boolean" } },
        { path: ["text"], schema: { type: "string" } },
      ],
    });
    const seeded = buildInitialEdits(req);
    expect(seeded[pathKey(["flag"])]).toBe(false);
    expect(seeded[pathKey(["text"])]).toBe("");
  });
});

describe("composeEditedArgs", () => {
  it("returns undefined when no editable", () => {
    expect(composeEditedArgs(makeRequest(), {})).toBeUndefined();
  });

  it("returns undefined when no values changed", () => {
    const req = makeRequest({
      editable: [{ path: ["x"], schema: { type: "string" } }],
      config: { toolArgs: { x: "same" } },
    });
    expect(composeEditedArgs(req, { x: "same" })).toBeUndefined();
  });

  it("returns patched object preserving untouched keys", () => {
    const req = makeRequest({
      editable: [{ path: ["x"], schema: { type: "string" } }],
      config: { toolArgs: { x: "old", y: "kept" } },
    });
    expect(composeEditedArgs(req, { x: "new" })).toEqual({ x: "new", y: "kept" });
  });

  it("supports nested paths", () => {
    const req = makeRequest({
      editable: [{ path: ["a", "b"], schema: { type: "string" } }],
      config: { toolArgs: { a: { b: "old", c: "kept" } } },
    });
    expect(composeEditedArgs(req, { "a.b": "new" })).toEqual({ a: { b: "new", c: "kept" } });
  });
});

describe("buildOutcome", () => {
  const allowOption: ApprovalOption = { value: "allow_once", label: "Allow", role: "allow_once" };
  const denyOption: ApprovalOption = { value: "deny", label: "Deny", role: "deny" };

  it("returns selectedOption verbatim", () => {
    const outcome = buildOutcome(makeRequest(), allowOption, {}, {});
    expect(outcome.selectedOption).toBe("allow_once");
  });

  it("includes answers array shaped by request.questions order", () => {
    const req = makeRequest({
      questions: [
        { index: 0, topic: "a", question: "A?" },
        { index: 1, topic: "b", question: "B?" },
      ],
    });
    const outcome = buildOutcome(req, allowOption, { 0: "alpha", 1: "beta" }, {});
    expect(outcome.answers).toEqual([
      { index: 0, answer: "alpha" },
      { index: 1, answer: "beta" },
    ]);
  });

  it("strips editedArgs when option is deny", () => {
    const req = makeRequest({
      editable: [{ path: ["x"], schema: { type: "string" } }],
      config: { toolArgs: { x: "old" } },
    });
    const outcome = buildOutcome(req, denyOption, {}, { x: "new" });
    expect(outcome.editedArgs).toBeUndefined();
  });

  it("includes editedArgs when option is allow", () => {
    const req = makeRequest({
      editable: [{ path: ["x"], schema: { type: "string" } }],
      config: { toolArgs: { x: "old" } },
    });
    const outcome = buildOutcome(req, allowOption, {}, { x: "new" });
    expect(outcome.editedArgs).toEqual({ x: "new" });
  });

  it("handles default approve/deny fixture", () => {
    const req = makeRequest();
    expect(buildOutcome(req, allowOption, {}, {}).selectedOption).toBe("allow_once");
    expect(buildOutcome(req, denyOption, {}, {}).selectedOption).toBe("deny");
  });
});
