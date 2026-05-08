import { describe, expect, it } from "vitest";
import type { VariableSpec } from "@nodes/_variables";
import {
  isMissingRequiredValue,
  isPresentVariableValue,
  isSpecVisible,
} from "@/lib/flow/variable-visibility";

function spec(partial: Partial<VariableSpec> & Pick<VariableSpec, "id">): VariableSpec {
  return {
    label: partial.label ?? partial.id,
    control: partial.control ?? { kind: "text" },
    placement: "header",
    ...partial,
  } as VariableSpec;
}

describe("isPresentVariableValue", () => {
  it("rejects null/undefined/blank string/empty array", () => {
    expect(isPresentVariableValue(undefined)).toBe(false);
    expect(isPresentVariableValue(null)).toBe(false);
    expect(isPresentVariableValue("")).toBe(false);
    expect(isPresentVariableValue("   ")).toBe(false);
    expect(isPresentVariableValue([])).toBe(false);
  });

  it("rejects non-finite numbers", () => {
    expect(isPresentVariableValue(Number.NaN)).toBe(false);
    expect(isPresentVariableValue(Infinity)).toBe(false);
  });

  it("accepts truthy strings, numbers, booleans, arrays, objects", () => {
    expect(isPresentVariableValue("x")).toBe(true);
    expect(isPresentVariableValue(0)).toBe(true);
    expect(isPresentVariableValue(false)).toBe(true);
    expect(isPresentVariableValue([1])).toBe(true);
    expect(isPresentVariableValue({})).toBe(true);
  });
});

describe("isMissingRequiredValue", () => {
  it("returns false for non-required specs regardless of value", () => {
    const s = spec({ id: "a", required: false });
    expect(isMissingRequiredValue(s, undefined)).toBe(false);
    expect(isMissingRequiredValue(s, "")).toBe(false);
  });

  it("flags required specs with absent values", () => {
    const s = spec({ id: "a", required: true });
    expect(isMissingRequiredValue(s, undefined)).toBe(true);
    expect(isMissingRequiredValue(s, "  ")).toBe(true);
    expect(isMissingRequiredValue(s, [])).toBe(true);
    expect(isMissingRequiredValue(s, "value")).toBe(false);
    expect(isMissingRequiredValue(s, 0)).toBe(false);
  });
});

describe("isSpecVisible", () => {
  it("is visible when no show_when present", () => {
    expect(isSpecVisible(spec({ id: "a" }), {})).toBe(true);
  });

  it("is visible when show_when has zero rules", () => {
    expect(isSpecVisible(spec({ id: "a", show_when: {} }), {})).toBe(true);
  });

  it("evaluates valueEquals", () => {
    const s = spec({
      id: "a",
      show_when: { valueEquals: [{ paramId: "mode", value: "advanced" }] },
    });
    expect(isSpecVisible(s, { mode: "advanced" })).toBe(true);
    expect(isSpecVisible(s, { mode: "basic" })).toBe(false);
  });

  it("evaluates valueIn / valueNotIn", () => {
    const inS = spec({
      id: "a",
      show_when: { valueIn: [{ paramId: "k", values: ["x", "y"] }] },
    });
    const notInS = spec({
      id: "a",
      show_when: { valueNotIn: [{ paramId: "k", values: ["x", "y"] }] },
    });
    expect(isSpecVisible(inS, { k: "y" })).toBe(true);
    expect(isSpecVisible(inS, { k: "z" })).toBe(false);
    expect(isSpecVisible(notInS, { k: "z" })).toBe(true);
    expect(isSpecVisible(notInS, { k: "y" })).toBe(false);
  });

  it("evaluates valueNotEquals", () => {
    const s = spec({
      id: "a",
      show_when: { valueNotEquals: [{ paramId: "k", value: "off" }] },
    });
    expect(isSpecVisible(s, { k: "on" })).toBe(true);
    expect(isSpecVisible(s, { k: "off" })).toBe(false);
  });

  it("evaluates exists / notExists", () => {
    const e = spec({ id: "a", show_when: { exists: ["dep"] } });
    const ne = spec({ id: "a", show_when: { notExists: ["dep"] } });
    expect(isSpecVisible(e, { dep: "x" })).toBe(true);
    expect(isSpecVisible(e, {})).toBe(false);
    expect(isSpecVisible(e, { dep: "" })).toBe(false);
    expect(isSpecVisible(ne, {})).toBe(true);
    expect(isSpecVisible(ne, { dep: "x" })).toBe(false);
  });

  it("requires ALL rules to pass when multiple rule kinds are present", () => {
    const s = spec({
      id: "a",
      show_when: {
        valueEquals: [{ paramId: "mode", value: "adv" }],
        exists: ["token"],
      },
    });
    expect(isSpecVisible(s, { mode: "adv", token: "t" })).toBe(true);
    expect(isSpecVisible(s, { mode: "adv" })).toBe(false);
    expect(isSpecVisible(s, { token: "t" })).toBe(false);
  });

  it("treats missing dependency value as undefined (not visible for valueEquals)", () => {
    const s = spec({
      id: "a",
      show_when: { valueEquals: [{ paramId: "missing", value: "x" }] },
    });
    expect(isSpecVisible(s, {})).toBe(false);
  });

  it("supports transitive visibility when caller pre-filters parents", () => {
    const a = spec({
      id: "a",
      show_when: { valueEquals: [{ paramId: "b", value: "yes" }] },
    });
    const b = spec({
      id: "b",
      show_when: { valueEquals: [{ paramId: "c", value: "yes" }] },
    });

    const values = { c: "yes", b: "yes" };
    expect(isSpecVisible(b, values)).toBe(true);
    expect(isSpecVisible(a, values)).toBe(true);

    const hidden = { c: "no", b: "yes" };
    expect(isSpecVisible(b, hidden)).toBe(false);
    expect(isSpecVisible(a, hidden)).toBe(true);
  });

  it("uses Object.is for comparisons (NaN === NaN, ±0 distinct)", () => {
    const nan = spec({
      id: "a",
      show_when: { valueEquals: [{ paramId: "k", value: Number.NaN }] },
    });
    expect(isSpecVisible(nan, { k: Number.NaN })).toBe(true);

    const zero = spec({
      id: "a",
      show_when: { valueEquals: [{ paramId: "k", value: 0 }] },
    });
    expect(isSpecVisible(zero, { k: -0 })).toBe(false);
    expect(isSpecVisible(zero, { k: 0 })).toBe(true);
  });

  it("does not coerce booleans (string 'true' is not boolean true)", () => {
    const s = spec({
      id: "a",
      show_when: { valueEquals: [{ paramId: "k", value: true }] },
    });
    expect(isSpecVisible(s, { k: "true" })).toBe(false);
    expect(isSpecVisible(s, { k: 1 })).toBe(false);
    expect(isSpecVisible(s, { k: true })).toBe(true);
  });
});
