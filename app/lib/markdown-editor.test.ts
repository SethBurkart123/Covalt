import { describe, expect, it } from "vitest";
import { roundTripMarkdown } from "@/lib/markdown-editor";

function normalizeMarkdown(content: string): string {
  return content.replace(/\r\n/g, "\n").trim();
}

function expectStableRoundTrip(input: string, expectedSnippets: Array<string | RegExp>) {
  const output = normalizeMarkdown(roundTripMarkdown(input));

  expectedSnippets.forEach((snippet) => {
    if (typeof snippet === "string") {
      expect(output).toContain(snippet);
      return;
    }

    expect(output).toMatch(snippet);
  });

  expect(normalizeMarkdown(roundTripMarkdown(output))).toBe(output);
}

describe("markdown-editor", () => {
  it("round-trips common markdown formatting", () => {
    expectStableRoundTrip(
      [
        "# Heading",
        "",
        "Paragraph with **bold**, *italic*, `code`, and [a link](https://example.com).",
        "",
        "> Quoted text",
        "",
        "---",
      ].join("\n"),
      [
        "# Heading",
        "**bold**",
        "*italic*",
        "`code`",
        "[a link](https://example.com)",
        "> Quoted text",
        "---",
      ]
    );
  });

  it("round-trips tables, task lists, and images", () => {
    expectStableRoundTrip(
      [
        "- [x] done",
        "- [ ] pending",
        "",
        "| Column A | Column B |",
        "| --- | --- |",
        "| 1 | 2 |",
        "",
        "![diagram](https://example.com/diagram.png)",
      ].join("\n"),
      [
        "- [x] done",
        "- [ ] pending",
        "| Column A | Column B |",
        /\|\s*1\s*\|\s*2\s*\|/,
        "![diagram](https://example.com/diagram.png)",
      ]
    );
  });

  it("round-trips fenced code blocks and math", () => {
    expectStableRoundTrip(
      [
        "```ts",
        "const answer = 42;",
        "```",
        "",
        "$E = mc^2$",
        "",
        "$$",
        "a^2 + b^2 = c^2",
        "$$",
      ].join("\n"),
      [
        "```ts",
        "const answer = 42;",
        "$E = mc^2$",
        "$$\na^2 + b^2 = c^2\n$$",
      ]
    );
  });
});
