import { describe, expect, it } from "vitest";
import { truncateMiddleToWidth } from "../middle-truncate";

const fixedWidth = (value: string) => value.length;

describe("truncateMiddleToWidth", () => {
  it("returns the full text when it fits", () => {
    expect(truncateMiddleToWidth("short.txt", 20, fixedWidth)).toBe("short.txt");
  });

  it("keeps the start and end when truncating", () => {
    const result = truncateMiddleToWidth(
      "/Users/sethburkart/Downloads/Claude App Concept Brainstorming.md",
      28,
      fixedWidth,
    );

    expect(result).toContain("...");
    expect(result.startsWith("/Users")).toBe(true);
    expect(result.endsWith(".md")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(28);
  });

  it("returns an empty string when even the ellipsis cannot fit", () => {
    expect(truncateMiddleToWidth("abcdef", 2, fixedWidth)).toBe("");
  });
});
