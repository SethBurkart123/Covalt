import { describe, expect, it, beforeEach } from "vitest";
import type { VariableSpec } from "@nodes/_variables";
import {
  buildDefaults,
  defaultForControl,
  loadPersistedValues,
  persistVariableValues,
} from "@/lib/flow/variable-defaults";

function spec(partial: Partial<VariableSpec> & Pick<VariableSpec, "id" | "control">): VariableSpec {
  return {
    label: partial.label ?? partial.id,
    placement: "header",
    ...partial,
  } as VariableSpec;
}

describe("defaultForControl", () => {
  it("returns false for boolean", () => {
    expect(defaultForControl(spec({ id: "a", control: { kind: "boolean" } }))).toBe(false);
  });

  it("uses min for number/slider; falls back to 0 when missing", () => {
    expect(defaultForControl(spec({ id: "n", control: { kind: "number", min: 5 } }))).toBe(5);
    expect(defaultForControl(spec({ id: "n", control: { kind: "number" } }))).toBe(0);
    expect(
      defaultForControl(spec({ id: "s", control: { kind: "slider", min: 2, max: 10 } })),
    ).toBe(2);
  });

  it("returns [] for multi select/searchable and undefined for single", () => {
    expect(
      defaultForControl(spec({ id: "m", control: { kind: "select", multi: true } })),
    ).toEqual([]);
    expect(
      defaultForControl(spec({ id: "m", control: { kind: "searchable", multi: true } })),
    ).toEqual([]);
    expect(defaultForControl(spec({ id: "s", control: { kind: "select" } }))).toBeUndefined();
    expect(
      defaultForControl(spec({ id: "s", control: { kind: "searchable" } })),
    ).toBeUndefined();
  });

  it("returns empty string for text controls", () => {
    expect(defaultForControl(spec({ id: "t", control: { kind: "text" } }))).toBe("");
    expect(
      defaultForControl(spec({ id: "ta", control: { kind: "text-area", rows: 3 } })),
    ).toBe("");
  });
});

describe("buildDefaults", () => {
  it("prefers spec.default over control default", () => {
    const specs: VariableSpec[] = [
      spec({ id: "a", control: { kind: "text" }, default: "hello" }),
      spec({ id: "b", control: { kind: "boolean" }, default: true }),
      spec({ id: "c", control: { kind: "number", min: 5 } }),
    ];
    expect(buildDefaults(specs)).toEqual({ a: "hello", b: true, c: 5 });
  });

  it("uses control default when spec.default is missing", () => {
    const specs: VariableSpec[] = [
      spec({ id: "x", control: { kind: "boolean" } }),
      spec({ id: "y", control: { kind: "select", multi: true } }),
    ];
    expect(buildDefaults(specs)).toEqual({ x: false, y: [] });
  });

  it("preserves type-mismatched defaults verbatim (no coercion)", () => {
    const specs: VariableSpec[] = [
      spec({ id: "n", control: { kind: "number" }, default: "not-a-number" }),
    ];
    expect(buildDefaults(specs)).toEqual({ n: "not-a-number" });
  });
});

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

describe("persistVariableValues / loadPersistedValues", () => {
  beforeEach(() => {
    const storage = new MemoryStorage();
    (globalThis as unknown as { window: unknown }).window = { localStorage: storage };
    (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;
  });

  it("returns defaults when storageKey is null", () => {
    const defaults = { a: "x" };
    expect(loadPersistedValues(null, defaults)).toEqual(defaults);
    expect(loadPersistedValues(null, defaults)).not.toBe(defaults);
  });

  it("round-trips values through localStorage", () => {
    persistVariableValues("k", { a: 1, b: "two" });
    const loaded = loadPersistedValues("k", { a: 0, b: "", c: false });
    expect(loaded).toEqual({ a: 1, b: "two", c: false });
  });

  it("ignores corrupt JSON and falls back to defaults", () => {
    (globalThis as unknown as { localStorage: MemoryStorage }).localStorage.setItem(
      "k",
      "not json",
    );
    const defaults = { a: "fallback" };
    expect(loadPersistedValues("k", defaults)).toEqual(defaults);
  });

  it("ignores payloads with mismatched version", () => {
    (globalThis as unknown as { localStorage: MemoryStorage }).localStorage.setItem(
      "k",
      JSON.stringify({ version: 999, values: { a: "stale" } }),
    );
    expect(loadPersistedValues("k", { a: "fresh" })).toEqual({ a: "fresh" });
  });

  it("merges persisted values onto defaults preferring persisted", () => {
    (globalThis as unknown as { localStorage: MemoryStorage }).localStorage.setItem(
      "k",
      JSON.stringify({ version: 1, values: { a: "persisted" } }),
    );
    expect(loadPersistedValues("k", { a: "default", b: "default-b" })).toEqual({
      a: "persisted",
      b: "default-b",
    });
  });
});
