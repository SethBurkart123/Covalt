import { describe, expect, it, vi } from "vitest";

vi.mock("prism-react-renderer", () => ({
  Prism: {
    languages: { text: {}, typescript: {}, tsx: {} },
    highlight: (code: string) => code,
  },
}));

import { buildDiffRows, countDiffLines } from "../DiffView";

describe("countDiffLines", () => {
  it("counts simple replacement", () => {
    expect(countDiffLines("hello", "world")).toEqual({ additions: 1, deletions: 1 });
  });

  it("counts pure additions", () => {
    expect(countDiffLines("a", "a\nb")).toEqual({ additions: 1, deletions: 0 });
  });

  it("counts pure deletions", () => {
    expect(countDiffLines("a\nb", "a")).toEqual({ additions: 0, deletions: 1 });
  });

  it("returns zeros for identical text", () => {
    expect(countDiffLines("same", "same")).toEqual({ additions: 0, deletions: 0 });
  });

  it("returns zeros for empty inputs", () => {
    expect(countDiffLines("", "")).toEqual({ additions: 0, deletions: 0 });
  });
});

describe("buildDiffRows", () => {
  it("builds rows synchronously with line numbers", () => {
    expect(buildDiffRows("a\nb\nc", "a\nbeta\nc")).toEqual([
      { kind: "context", oldLineNumber: 1, newLineNumber: 1, content: "a" },
      { kind: "delete", oldLineNumber: 2, content: "b" },
      { kind: "add", newLineNumber: 2, content: "beta" },
      { kind: "context", oldLineNumber: 3, newLineNumber: 3, content: "c" },
    ]);
  });

  it("preserves blank lines in additions", () => {
    expect(buildDiffRows("", "\n")).toEqual([
      { kind: "add", newLineNumber: 1, content: "" },
    ]);
  });
});
