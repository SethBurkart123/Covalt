import { describe, expect, it } from "vitest";
import * as React from "react";

(globalThis as { React?: typeof React }).React = React;

import { Renderer, isValidSpec, type ComponentRegistry, type Spec } from "../engine";

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

function flattenText(node: unknown): string {
  if (node == null || node === false || node === true) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (!isElement(node)) return "";
  const props = (node.props ?? {}) as Record<string, unknown>;
  return flattenText(props.children);
}

function findByTestId(node: unknown, id: string): AnyElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByTestId(child, id);
      if (found) return found;
    }
    return null;
  }
  if (!isElement(node)) return null;
  const props = (node.props ?? {}) as Record<string, unknown>;
  if (props["data-testid"] === id) return node;
  return findByTestId(props.children, id);
}

function makeRegistry(): ComponentRegistry {
  return {
    Box: ({ renderChildren }) => <div data-testid="box">{renderChildren()}</div>,
    Leaf: ({ props }) => <span data-testid="leaf">{String(props.label ?? "")}</span>,
  };
}

describe("isValidSpec", () => {
  it("accepts well-formed spec", () => {
    expect(
      isValidSpec({
        root: "a",
        elements: { a: { type: "Leaf" } },
      }),
    ).toBe(true);
  });

  it("rejects when root id missing from elements", () => {
    expect(isValidSpec({ root: "missing", elements: {} })).toBe(false);
  });

  it("rejects null and primitives", () => {
    expect(isValidSpec(null)).toBe(false);
    expect(isValidSpec(42)).toBe(false);
    expect(isValidSpec("nope")).toBe(false);
  });

  it("rejects when elements is missing", () => {
    expect(isValidSpec({ root: "a" })).toBe(false);
  });
});

describe("Renderer", () => {
  it("renders a single root element", () => {
    const spec: Spec = {
      root: "a",
      elements: { a: { type: "Leaf", props: { label: "hi" } } },
    };
    const tree = Renderer({ spec, registry: makeRegistry() });
    const leaf = findByTestId(tree, "leaf");
    expect(leaf).not.toBeNull();
    expect(flattenText(tree)).toContain("hi");
  });

  it("renders nested children via renderChildren", () => {
    const spec: Spec = {
      root: "root",
      elements: {
        root: { type: "Box", children: ["a", "b"] },
        a: { type: "Leaf", props: { label: "x" } },
        b: { type: "Leaf", props: { label: "y" } },
      },
    };
    const tree = Renderer({ spec, registry: makeRegistry() });
    expect(findByTestId(tree, "box")).not.toBeNull();
    expect(flattenText(tree)).toContain("x");
    expect(flattenText(tree)).toContain("y");
  });

  it("returns fallback when spec invalid", () => {
    const fallback = <div data-testid="fallback">fallback</div>;
    const tree = Renderer({
      spec: { root: "missing" } as unknown as Spec,
      registry: makeRegistry(),
      fallback,
    });
    expect(findByTestId(tree, "fallback")).not.toBeNull();
  });

  it("renders unknown component error", () => {
    const spec: Spec = {
      root: "a",
      elements: { a: { type: "DoesNotExist" } },
    };
    const tree = Renderer({ spec, registry: makeRegistry() });
    expect(flattenText(tree)).toContain("Unknown component");
    expect(flattenText(tree)).toContain("DoesNotExist");
  });

  it("detects cycles when an element references itself", () => {
    const spec: Spec = {
      root: "a",
      elements: {
        a: { type: "Box", children: ["b"] },
        b: { type: "Box", children: ["a"] },
      },
    };
    const tree = Renderer({ spec, registry: makeRegistry() });
    expect(flattenText(tree)).toContain("Cycle detected");
  });

  it("renders missing element error for dangling child reference", () => {
    const spec: Spec = {
      root: "a",
      elements: {
        a: { type: "Box", children: ["ghost"] },
      },
    };
    const tree = Renderer({ spec, registry: makeRegistry() });
    expect(flattenText(tree)).toContain("Missing element");
  });
});
