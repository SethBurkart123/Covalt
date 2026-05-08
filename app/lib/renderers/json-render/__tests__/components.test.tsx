import { describe, expect, it } from "vitest";
import * as React from "react";

(globalThis as { React?: typeof React }).React = React;

import type { ComponentRenderer } from "../engine";
import { defaultJsonRenderRegistry } from "../components";

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

function flatten(node: unknown): string {
  if (node == null || node === false || node === true) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flatten).join("");
  if (!isElement(node)) return "";
  const props = (node.props ?? {}) as Record<string, unknown>;
  return flatten(props.children);
}

function call(
  renderer: ComponentRenderer,
  props: Record<string, unknown>,
  children: string[] = [],
): unknown {
  return renderer({
    id: "test",
    props,
    children,
    renderChildren: () => null,
  });
}

const ALL_TYPES = [
  "Box",
  "Text",
  "Heading",
  "Divider",
  "Newline",
  "Spacer",
  "BarChart",
  "Sparkline",
  "Table",
  "List",
  "Card",
  "StatusLine",
  "KeyValue",
  "Badge",
  "ProgressBar",
  "Metric",
  "Callout",
  "Timeline",
];

describe("defaultJsonRenderRegistry", () => {
  it("registers all 18 component types", () => {
    for (const type of ALL_TYPES) {
      expect(defaultJsonRenderRegistry).toHaveProperty(type);
      expect(typeof defaultJsonRenderRegistry[type]).toBe("function");
    }
  });
});

describe("Box", () => {
  it("renders a div with column flex by default", () => {
    const out = call(defaultJsonRenderRegistry.Box, {});
    expect(isElement(out)).toBe(true);
  });

  it("applies row flex when flexDirection=row", () => {
    const out = call(defaultJsonRenderRegistry.Box, { flexDirection: "row" });
    expect(isElement(out)).toBe(true);
    const props = (out as AnyElement).props ?? {};
    const style = props.style as Record<string, unknown> | undefined;
    expect(style?.flexDirection).toBe("row");
  });

  it("applies border styling when borderStyle present", () => {
    const out = call(defaultJsonRenderRegistry.Box, { borderStyle: "solid" });
    const props = (out as AnyElement).props ?? {};
    expect(typeof props.className).toBe("string");
    expect(String(props.className)).toContain("border");
  });
});

describe("Text", () => {
  it("renders text prop content", () => {
    const out = call(defaultJsonRenderRegistry.Text, { text: "hello" });
    expect(flatten(out)).toBe("hello");
  });

  it("applies bold when bold=true", () => {
    const out = call(defaultJsonRenderRegistry.Text, { text: "hi", bold: true });
    const className = ((out as AnyElement).props ?? {}).className as string;
    expect(className).toContain("font-semibold");
  });
});

describe("Heading", () => {
  it("renders h2 by default", () => {
    const out = call(defaultJsonRenderRegistry.Heading, { text: "Title" });
    expect((out as AnyElement).type).toBe("h2");
    expect(flatten(out)).toBe("Title");
  });

  it("renders correct tag for h1/h3/h4", () => {
    expect(((call(defaultJsonRenderRegistry.Heading, { level: "h1", text: "x" }) as AnyElement).type)).toBe("h1");
    expect(((call(defaultJsonRenderRegistry.Heading, { level: "h3", text: "x" }) as AnyElement).type)).toBe("h3");
    expect(((call(defaultJsonRenderRegistry.Heading, { level: "h4", text: "x" }) as AnyElement).type)).toBe("h4");
  });
});

describe("Divider", () => {
  it("renders a separator without title", () => {
    const out = call(defaultJsonRenderRegistry.Divider, {});
    expect(isElement(out)).toBe(true);
  });

  it("renders title text when provided", () => {
    const out = call(defaultJsonRenderRegistry.Divider, { title: "section" });
    expect(flatten(out)).toContain("section");
  });
});

describe("Newline & Spacer", () => {
  it("Newline renders an element", () => {
    expect(isElement(call(defaultJsonRenderRegistry.Newline, {}))).toBe(true);
  });
  it("Spacer renders an element", () => {
    expect(isElement(call(defaultJsonRenderRegistry.Spacer, {}))).toBe(true);
  });
});

describe("BarChart", () => {
  it("renders bars for each datum and shows percentage when requested", () => {
    const out = call(defaultJsonRenderRegistry.BarChart, {
      data: [
        { label: "A", value: 1 },
        { label: "B", value: 3 },
      ],
      showPercentage: true,
    });
    const text = flatten(out);
    expect(text).toContain("A");
    expect(text).toContain("B");
    expect(text).toContain("%");
  });

  it("handles empty data without throwing", () => {
    expect(isElement(call(defaultJsonRenderRegistry.BarChart, {}))).toBe(true);
  });
});

describe("Sparkline", () => {
  it("renders nothing for empty data", () => {
    const out = call(defaultJsonRenderRegistry.Sparkline, { data: [] });
    expect(out).toBeNull();
  });

  it("renders an svg element when data is provided", () => {
    const out = call(defaultJsonRenderRegistry.Sparkline, { data: [1, 2, 3] });
    expect(isElement(out)).toBe(true);
  });
});

describe("Table", () => {
  it("renders headers and row cells", () => {
    const out = call(defaultJsonRenderRegistry.Table, {
      columns: [
        { header: "Name", key: "name" },
        { header: "Count", key: "count" },
      ],
      rows: [{ name: "alpha", count: 7 }],
    });
    const text = flatten(out);
    expect(text).toContain("Name");
    expect(text).toContain("alpha");
    expect(text).toContain("7");
  });
});

describe("List", () => {
  it("renders ul by default", () => {
    const out = call(defaultJsonRenderRegistry.List, { items: ["a", "b"] });
    expect((out as AnyElement).type).toBe("ul");
    expect(flatten(out)).toContain("a");
  });

  it("renders ol when ordered", () => {
    const out = call(defaultJsonRenderRegistry.List, { items: ["a"], ordered: true });
    expect((out as AnyElement).type).toBe("ol");
  });
});

describe("Card", () => {
  it("renders without title", () => {
    expect(isElement(call(defaultJsonRenderRegistry.Card, {}))).toBe(true);
  });

  it("includes title text when provided", () => {
    const out = call(defaultJsonRenderRegistry.Card, { title: "Snapshot" });
    expect(flatten(out)).toContain("Snapshot");
  });
});

describe("StatusLine", () => {
  it("renders status pill and text", () => {
    const out = call(defaultJsonRenderRegistry.StatusLine, {
      text: "All good",
      status: "success",
    });
    const text = flatten(out);
    expect(text).toContain("success");
    expect(text).toContain("All good");
  });

  it("falls back to info for missing/invalid status", () => {
    const out = call(defaultJsonRenderRegistry.StatusLine, { text: "x", status: "weird" });
    expect(flatten(out)).toContain("info");
  });
});

describe("KeyValue", () => {
  it("renders label and value", () => {
    const out = call(defaultJsonRenderRegistry.KeyValue, { label: "name", value: "alpha" });
    const text = flatten(out);
    expect(text).toContain("name");
    expect(text).toContain("alpha");
  });
});

describe("Badge", () => {
  it("renders the label", () => {
    const out = call(defaultJsonRenderRegistry.Badge, { label: "new" });
    expect(flatten(out)).toContain("new");
  });
});

describe("ProgressBar", () => {
  it("clamps progress and renders label/percentage", () => {
    const out = call(defaultJsonRenderRegistry.ProgressBar, {
      progress: 1.5,
      label: "Loading",
    });
    const text = flatten(out);
    expect(text).toContain("Loading");
    expect(text).toContain("100%");
  });

  it("clamps negative progress", () => {
    const out = call(defaultJsonRenderRegistry.ProgressBar, { progress: -0.5, label: "x" });
    expect(flatten(out)).toContain("0%");
  });
});

describe("Metric", () => {
  it("renders label and value", () => {
    const out = call(defaultJsonRenderRegistry.Metric, { label: "Users", value: 42 });
    const text = flatten(out);
    expect(text).toContain("Users");
    expect(text).toContain("42");
  });

  it("includes Up indicator when trend=up", () => {
    const out = call(defaultJsonRenderRegistry.Metric, { label: "X", value: 1, trend: "up" });
    expect(flatten(out)).toContain("Up");
  });

  it("includes Down indicator when trend=down", () => {
    const out = call(defaultJsonRenderRegistry.Metric, { label: "X", value: 1, trend: "down" });
    expect(flatten(out)).toContain("Down");
  });
});

describe("Callout", () => {
  it("renders title and content", () => {
    const out = call(defaultJsonRenderRegistry.Callout, {
      type: "warning",
      title: "Heads up",
      content: "Something happened",
    });
    const text = flatten(out);
    expect(text).toContain("Heads up");
    expect(text).toContain("Something happened");
  });
});

describe("Timeline", () => {
  it("renders item titles and descriptions", () => {
    const out = call(defaultJsonRenderRegistry.Timeline, {
      items: [
        { title: "Step 1", description: "first", status: "success" },
        { title: "Step 2", status: "info" },
      ],
    });
    const text = flatten(out);
    expect(text).toContain("Step 1");
    expect(text).toContain("first");
    expect(text).toContain("Step 2");
  });
});
