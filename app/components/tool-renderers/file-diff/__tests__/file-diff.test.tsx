import { describe, expect, it, vi } from "vitest";

vi.mock("prism-react-renderer", () => ({
  Prism: {
    languages: { text: {}, typescript: {}, tsx: {} },
    highlight: (code: string) => code,
  },
}));

import { countDiffLines } from "../DiffView";

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
