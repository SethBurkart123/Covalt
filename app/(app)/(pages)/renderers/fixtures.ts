import type { Spec } from "@/lib/renderers/json-render/types";

export const PATCH_SAMPLE = `*** Begin Patch
*** Update File: src/utils.ts
@@
-export const greet = (n: string) => "hi " + n;
+export const greet = (n: string) => \`hello \${n}\`;
*** Add File: src/new.ts
@@
+export const constant = 42;
*** End Patch`;

export const FILE_OLD = `function add(a, b) {
  return a + b;
}

function sub(a, b) {
  return a - b;
}`;

export const FILE_NEW = `function add(a: number, b: number): number {
  return a + b;
}

function sub(a: number, b: number): number {
  return a - b;
}

function mul(a: number, b: number): number {
  return a * b;
}`;

export const READ_CONTENT = `import { useState } from "react";

export function useCounter(initial = 0) {
  const [count, setCount] = useState(initial);
  const inc = () => setCount(c => c + 1);
  const dec = () => setCount(c => c - 1);
  return { count, inc, dec };
}`;

export const SEARCH_RESULTS = [
  {
    title: "Tinygrad — A simple, no-bloat neural net framework",
    url: "https://github.com/tinygrad/tinygrad",
    snippet: "Tinygrad is a deep learning framework that aims to be the easiest framework to add new accelerators to.",
    domain: "github.com",
    date: "2024-09-12",
  },
  {
    title: "Why Tinygrad is the future",
    url: "https://geohot.github.io/blog/jekyll/update/2023/05/24/why-tinygrad.html",
    snippet: "A short rant about why simple frameworks beat complex ones in the long run.",
    date: "2023-05-24",
  },
  {
    title: "Tinygrad documentation",
    url: "https://docs.tinygrad.org",
    snippet: "Getting started · Installation · Core concepts · Examples · API reference",
    domain: "docs.tinygrad.org",
  },
];

export const TODOS = [
  { id: "1", content: "Design renderer registry", status: "completed" as const },
  { id: "2", content: "Build the approval router", status: "completed" as const },
  { id: "3", content: "Wire droid permission handler", status: "in_progress" as const },
  { id: "4", content: "Add token usage display", status: "pending" as const },
  { id: "5", content: "Write plugin docs", status: "pending" as const },
];

export const JSON_SPECS: Array<{ name: string; spec: Spec }> = [
  {
    name: "Box + Text + Heading",
    spec: {
      root: "root",
      elements: {
        root: { type: "Box", props: { flexDirection: "column", gap: 2, padding: 2, borderStyle: "round" }, children: ["h", "t1", "t2"] },
        h: { type: "Heading", props: { text: "Welcome", level: "h2" } },
        t1: { type: "Text", props: { text: "This is a primary line", bold: true, color: "primary" } },
        t2: { type: "Text", props: { text: "Subtle muted line", color: "muted" } },
      },
    },
  },
  {
    name: "BarChart",
    spec: {
      root: "root",
      elements: {
        root: {
          type: "BarChart",
          props: {
            showPercentage: true,
            data: [
              { label: "Cats", value: 12, color: "info" },
              { label: "Dogs", value: 8, color: "success" },
              { label: "Birds", value: 4, color: "warning" },
              { label: "Fish", value: 2, color: "danger" },
            ],
          },
        },
      },
    },
  },
  {
    name: "Sparkline",
    spec: {
      root: "root",
      elements: {
        root: { type: "Sparkline", props: { data: [3, 7, 2, 8, 6, 9, 5, 10, 12, 9, 14], color: "info" } },
      },
    },
  },
  {
    name: "Table",
    spec: {
      root: "root",
      elements: {
        root: {
          type: "Table",
          props: {
            headerColor: "muted",
            columns: [
              { header: "Name", key: "name" },
              { header: "Status", key: "status" },
              { header: "Count", key: "count" },
            ],
            rows: [
              { name: "Alpha", status: "active", count: 42 },
              { name: "Beta", status: "idle", count: 17 },
              { name: "Gamma", status: "stopped", count: 0 },
            ],
          },
        },
      },
    },
  },
  {
    name: "List (ordered + unordered)",
    spec: {
      root: "root",
      elements: {
        root: { type: "Box", props: { flexDirection: "column", gap: 3 }, children: ["l1", "l2"] },
        l1: { type: "List", props: { ordered: true, items: ["First", "Second", "Third"] } },
        l2: { type: "List", props: { items: ["Apples", "Oranges", "Pears"] } },
      },
    },
  },
  {
    name: "Card",
    spec: {
      root: "root",
      elements: {
        root: { type: "Card", props: { title: "Service health" }, children: ["c1"] },
        c1: { type: "Text", props: { text: "All systems operational." } },
      },
    },
  },
  {
    name: "StatusLine variants",
    spec: {
      root: "root",
      elements: {
        root: { type: "Box", props: { flexDirection: "column", gap: 1 }, children: ["s1", "s2", "s3", "s4"] },
        s1: { type: "StatusLine", props: { text: "API operational", status: "success" } },
        s2: { type: "StatusLine", props: { text: "Cache degraded", status: "warning" } },
        s3: { type: "StatusLine", props: { text: "Database offline", status: "error" } },
        s4: { type: "StatusLine", props: { text: "Job scheduled", status: "info" } },
      },
    },
  },
  {
    name: "KeyValue",
    spec: {
      root: "root",
      elements: {
        root: { type: "Box", props: { flexDirection: "column", gap: 1 }, children: ["k1", "k2", "k3"] },
        k1: { type: "KeyValue", props: { label: "Region", value: "us-east-1" } },
        k2: { type: "KeyValue", props: { label: "Cluster", value: "prod-east-1a" } },
        k3: { type: "KeyValue", props: { label: "Replicas", value: 3 } },
      },
    },
  },
  {
    name: "Badge variants",
    spec: {
      root: "root",
      elements: {
        root: { type: "Box", props: { flexDirection: "row", gap: 2 }, children: ["b1", "b2", "b3", "b4"] },
        b1: { type: "Badge", props: { label: "default" } },
        b2: { type: "Badge", props: { label: "success", variant: "success" } },
        b3: { type: "Badge", props: { label: "warn", variant: "warning" } },
        b4: { type: "Badge", props: { label: "danger", variant: "danger" } },
      },
    },
  },
  {
    name: "ProgressBar",
    spec: {
      root: "root",
      elements: {
        root: { type: "Box", props: { flexDirection: "column", gap: 2 }, children: ["p1", "p2", "p3"] },
        p1: { type: "ProgressBar", props: { progress: 0.25, label: "Downloading" } },
        p2: { type: "ProgressBar", props: { progress: 0.6, label: "Processing" } },
        p3: { type: "ProgressBar", props: { progress: 1, label: "Done" } },
      },
    },
  },
  {
    name: "Metric (with trends)",
    spec: {
      root: "root",
      elements: {
        root: { type: "Box", props: { flexDirection: "row", gap: 4 }, children: ["m1", "m2", "m3"] },
        m1: { type: "Metric", props: { label: "Requests", value: "12.4k" } },
        m2: { type: "Metric", props: { label: "p99", value: "184ms", trend: "up" } },
        m3: { type: "Metric", props: { label: "Errors", value: "0.2%", trend: "down" } },
      },
    },
  },
  {
    name: "Callout",
    spec: {
      root: "root",
      elements: {
        root: { type: "Box", props: { flexDirection: "column", gap: 2 }, children: ["c1", "c2", "c3", "c4"] },
        c1: { type: "Callout", props: { type: "info", title: "Heads up", content: "Plugin renderers are loaded lazily." } },
        c2: { type: "Callout", props: { type: "success", title: "Done", content: "All tests passing." } },
        c3: { type: "Callout", props: { type: "warning", title: "Watch out", content: "Approval queue has 3 pending items." } },
        c4: { type: "Callout", props: { type: "danger", title: "Error", content: "Database connection lost." } },
      },
    },
  },
  {
    name: "Timeline",
    spec: {
      root: "root",
      elements: {
        root: {
          type: "Timeline",
          props: {
            items: [
              { title: "Wave 0 — manifest extension", description: "Added RendererDescriptor", status: "completed" },
              { title: "Wave 1 — registry foundation", description: "Run-id + request-id approval state", status: "completed" },
              { title: "Wave 2 — UI plumbing", description: "ApprovalRouter shipped", status: "completed" },
              { title: "Wave 3 — built-in renderer pack", description: "11 renderers + 18 json-render components", status: "completed" },
              { title: "Wave 4 — droid parity", description: "Permission handler bridge live", status: "completed" },
              { title: "Wave 5 — polish & demo", description: "you are here", status: "in_progress" },
            ],
          },
        },
      },
    },
  },
  {
    name: "Divider + Newline + Spacer",
    spec: {
      root: "root",
      elements: {
        root: { type: "Box", props: { flexDirection: "column", gap: 1 }, children: ["t1", "d", "t2", "n", "t3"] },
        t1: { type: "Text", props: { text: "Above the divider" } },
        d: { type: "Divider", props: { title: "Section break" } },
        t2: { type: "Text", props: { text: "Between divider and newline" } },
        n: { type: "Newline", props: {} },
        t3: { type: "Text", props: { text: "After explicit newline" } },
      },
    },
  },
];
