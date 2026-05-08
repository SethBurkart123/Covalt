import { describe, expect, it } from "vitest";
import type { VariableSpec } from "@nodes/_variables";
import {
  defaultSourceFor,
  makeControl,
  makeEmptySpec,
  readSpecs,
  switchControlKind,
} from "@/components/flow/controls/variables-editor/shared";

describe("readSpecs", () => {
  it("returns [] for non-array input", () => {
    expect(readSpecs(null)).toEqual([]);
    expect(readSpecs(undefined)).toEqual([]);
    expect(readSpecs({})).toEqual([]);
    expect(readSpecs("hello")).toEqual([]);
  });

  it("filters non-spec entries (missing id, wrong type)", () => {
    const raw = [
      { id: "ok", label: "OK", control: { kind: "text" } },
      { label: "no id", control: { kind: "text" } },
      null,
      "string",
      { id: 42 },
    ];
    const out = readSpecs(raw);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("ok");
  });
});

describe("makeEmptySpec", () => {
  it("generates a unique id avoiding existing ones", () => {
    const existing: VariableSpec[] = [
      { id: "var_1", label: "a", control: { kind: "text" } } as VariableSpec,
      { id: "var_2", label: "b", control: { kind: "text" } } as VariableSpec,
    ];
    const next = makeEmptySpec(existing);
    expect(["var_3", "var_4"]).toContain(next.id);
    expect(existing.some((s) => s.id === next.id)).toBe(false);
  });

  it("attaches section when provided", () => {
    const next = makeEmptySpec([], "Group");
    expect(next.section).toBe("Group");
  });

  it("omits section when not provided", () => {
    const next = makeEmptySpec([]);
    expect(next).not.toHaveProperty("section");
  });

  it("defaults to text control and header placement", () => {
    const next = makeEmptySpec([]);
    expect(next.control).toEqual({ kind: "text" });
    expect(next.placement).toBe("header");
  });
});

describe("makeControl", () => {
  it("seeds slider with min/max/step", () => {
    expect(makeControl("slider")).toEqual({
      kind: "slider",
      min: 0,
      max: 1,
      step: 0.01,
    });
  });

  it("seeds text-area with rows", () => {
    expect(makeControl("text-area")).toEqual({ kind: "text-area", rows: 3 });
  });

  it("returns minimal shape for boolean/text/select/searchable/number", () => {
    expect(makeControl("text")).toEqual({ kind: "text" });
    expect(makeControl("number")).toEqual({ kind: "number" });
    expect(makeControl("boolean")).toEqual({ kind: "boolean" });
    expect(makeControl("select")).toEqual({ kind: "select" });
    expect(makeControl("searchable")).toEqual({ kind: "searchable" });
  });
});

describe("switchControlKind", () => {
  function base(): VariableSpec {
    return {
      id: "v",
      label: "v",
      control: { kind: "text" },
      placement: "header",
    };
  }

  it("clears options when switching to a non-selectable kind", () => {
    const start: VariableSpec = {
      ...base(),
      control: { kind: "select" },
      options: { kind: "static", options: [{ value: 1, label: "one" }] },
    };
    const next = switchControlKind(start, "text");
    expect(next.options).toBeUndefined();
    expect(next.control).toEqual({ kind: "text" });
  });

  it("seeds a static options source when switching to a selectable kind", () => {
    const next = switchControlKind(base(), "select");
    expect(next.options).toEqual({ kind: "static", options: [] });
  });

  it("preserves existing options when switching between selectable kinds", () => {
    const start: VariableSpec = {
      ...base(),
      control: { kind: "select" },
      options: { kind: "static", options: [{ value: 1, label: "one" }] },
    };
    const next = switchControlKind(start, "searchable");
    expect(next.options).toEqual(start.options);
  });
});

describe("defaultSourceFor", () => {
  it("returns the right shape for each source kind", () => {
    expect(defaultSourceFor("static")).toEqual({ kind: "static", options: [] });
    expect(defaultSourceFor("link")).toEqual({ kind: "link", socketType: "data" });
    expect(defaultSourceFor("callback")).toEqual({ kind: "callback", load: "" });
  });
});
