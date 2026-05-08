import { describe, expect, it } from "vitest";
import { stripAnsi, stripAnsiPreservingNewlines } from "../ansi-strip";

describe("stripAnsi", () => {
  it("strips color escape codes", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
  });

  it("preserves text content with no escapes", () => {
    expect(stripAnsi("plain text")).toBe("plain text");
  });

  it("returns empty string for empty input", () => {
    expect(stripAnsi("")).toBe("");
  });

  it("preserves newlines across multi-line input", () => {
    const input = "\x1b[32mline1\x1b[0m\nline2\n\x1b[33mline3\x1b[0m";
    expect(stripAnsi(input)).toBe("line1\nline2\nline3");
  });

  it("strips OSC sequences with BEL terminator", () => {
    expect(stripAnsi("\x1b]0;title\x07hello")).toBe("hello");
  });

  it("stripAnsiPreservingNewlines keeps line breaks", () => {
    expect(stripAnsiPreservingNewlines("a\nb\nc")).toBe("a\nb\nc");
  });
});
