import { describe, expect, it } from "vitest";
import { preprocessPartialMarkdown, __internal } from "./partial";

const {
  trimPartialMarkdown,
  completePartialInlineMarkdown,
  completePartialTableMarkdown,
  completePartialTaskListItem,
  isInsideUnterminatedFence,
} = __internal;

describe("trimPartialMarkdown", () => {
  it("strips a lone trailing non-whitespace character", () => {
    expect(trimPartialMarkdown("h")).toBe("");
    expect(trimPartialMarkdown("hello\nw")).toBe("hello\n");
  });

  it("strips trailing dangling delimiter starters", () => {
    expect(trimPartialMarkdown("hello**")).toBe("hello");
    expect(trimPartialMarkdown("hello~~")).toBe("hello");
    expect(trimPartialMarkdown("hello`")).toBe("hello");
    expect(trimPartialMarkdown("hello<")).toBe("hello");
    expect(trimPartialMarkdown("hello</")).toBe("hello");
    expect(trimPartialMarkdown("hello\\")).toBe("hello");
  });

  it("leaves completed lines alone", () => {
    expect(trimPartialMarkdown("hello world")).toBe("hello world");
    expect(trimPartialMarkdown("a paragraph.")).toBe("a paragraph.");
  });
});

describe("completePartialInlineMarkdown", () => {
  it("closes unmatched bold", () => {
    expect(completePartialInlineMarkdown("hello **world")).toBe("hello **world**");
  });

  it("closes unmatched italic with underscore", () => {
    expect(completePartialInlineMarkdown("hello _world")).toBe("hello _world_");
  });

  it("closes unmatched strikethrough", () => {
    expect(completePartialInlineMarkdown("hello ~~world")).toBe("hello ~~world~~");
  });

  it("closes unmatched inline code", () => {
    expect(completePartialInlineMarkdown("look at `foo")).toBe("look at `foo`");
  });

  it("closes bold and italic together", () => {
    expect(completePartialInlineMarkdown("***strong italic")).toBe("***strong italic***");
  });

  it("leaves matched delimiters alone", () => {
    expect(completePartialInlineMarkdown("**bold** and `code`")).toBe("**bold** and `code`");
  });

  it("ignores delimiters inside inline code", () => {
    expect(completePartialInlineMarkdown("`a * b * c`")).toBe("`a * b * c`");
  });

  it("completes partial links with no url", () => {
    const result = completePartialInlineMarkdown("see [docs");
    expect(result).toBe("see [docs](#)");
  });

  it("completes partial links with partial url, falling back to #", () => {
    const result = completePartialInlineMarkdown("see [docs](http");
    expect(result).toBe("see [docs](#)");
  });

  it("keeps a valid partial url", () => {
    const result = completePartialInlineMarkdown("see [docs](https://example.com");
    expect(result).toBe("see [docs](https://example.com)");
  });

  it("strips partial images", () => {
    expect(completePartialInlineMarkdown("![alt")).toBe("");
    expect(completePartialInlineMarkdown("before ![alt](http")).toBe("before ");
  });

  it("trims partial emoji modifiers", () => {
    const zwj = "\u200D";
    expect(completePartialInlineMarkdown(`hello${zwj}`)).toBe("hello");
  });

  it("trims partial regional indicator (flag) sequences", () => {
    const regional = "\uD83C\uDDFA";
    const result = completePartialInlineMarkdown(`hello${regional}`);
    expect(result).toBe("hello");
  });

  it("trims VS16 and its preceding codepoint", () => {
    const heart = "\u2764";
    const vs16 = "\uFE0F";
    expect(completePartialInlineMarkdown(`hi${heart}${vs16}`)).toBe("hi");
  });
});

describe("completePartialTableMarkdown", () => {
  it("synthesizes a separator row from a single header line", () => {
    const result = completePartialTableMarkdown("| a | b |");
    expect(result).toBe("| a | b |\n| --- | --- |");
  });

  it("handles a partial last header cell", () => {
    const result = completePartialTableMarkdown("| a | b");
    expect(result).toBe("| a | b |\n| --- | --- |");
  });

  it("returns undefined for a lone pipe", () => {
    expect(completePartialTableMarkdown("|")).toBeUndefined();
  });
});

describe("completePartialTaskListItem", () => {
  it("promotes '- [' to a checkbox", () => {
    expect(completePartialTaskListItem("- [")).toBe("- [ ] ");
  });

  it("promotes '- [x' to a checked checkbox", () => {
    expect(completePartialTaskListItem("- [x")).toBe("- [x] ");
  });

  it("leaves regular list items alone", () => {
    expect(completePartialTaskListItem("- hello")).toBe("- hello");
  });
});

describe("isInsideUnterminatedFence", () => {
  it("detects an open fence", () => {
    expect(isInsideUnterminatedFence("```ts\nconst x = 1")).toBe(true);
  });

  it("detects a closed fence", () => {
    expect(isInsideUnterminatedFence("```ts\nconst x = 1\n```")).toBe(false);
  });
});

describe("preprocessPartialMarkdown", () => {
  it("is a no-op on empty input", () => {
    expect(preprocessPartialMarkdown("")).toBe("");
  });

  it("normalizes CRLF newlines", () => {
    expect(preprocessPartialMarkdown("a\r\nbb")).toBe("a\nbb");
  });

  it("closes streaming bold mid-paragraph", () => {
    expect(preprocessPartialMarkdown("hello **wor")).toBe("hello **wor**");
  });

  it("removes dangling delimiter starters", () => {
    expect(preprocessPartialMarkdown("hello**")).toBe("hello");
  });

  it("optimistically completes a partial table header", () => {
    const result = preprocessPartialMarkdown("| a | b |");
    expect(result).toContain("| a | b |");
    expect(result).toContain("| --- | --- |");
  });

  it("leaves fenced code blocks untouched", () => {
    const input = "```ts\nconst foo = **bar";
    expect(preprocessPartialMarkdown(input)).toBe(input);
  });

  it("only mutates the trailing block, not the prefix", () => {
    const input = "first paragraph.\n\nsecond **par";
    const result = preprocessPartialMarkdown(input);
    expect(result.startsWith("first paragraph.\n\n")).toBe(true);
    expect(result).toContain("second **par**");
  });

  it("is idempotent on already-complete markdown", () => {
    const input = "hello **world** and [a link](https://example.com).";
    expect(preprocessPartialMarkdown(input)).toBe(input);
  });

  it("completes a partial link in a streaming sentence", () => {
    const result = preprocessPartialMarkdown("see [docs](https://example.com");
    expect(result).toBe("see [docs](https://example.com)");
  });

  it("strips a partial image", () => {
    const result = preprocessPartialMarkdown("before![alt");
    expect(result).toBe("before");
  });

  it("buffers a lone triple-backtick so md4w does not emit an empty code block", () => {
    expect(preprocessPartialMarkdown("```")).toBe("");
  });

  it("buffers a fence opener with partial language tag", () => {
    expect(preprocessPartialMarkdown("```py")).toBe("");
  });

  it("buffers a fence opener after a paragraph until newline arrives", () => {
    expect(preprocessPartialMarkdown("Hello\n\n```js")).toBe("Hello");
  });

  it("renders an in-progress reference-style link optimistically", () => {
    expect(preprocessPartialMarkdown("see [this one][an")).toBe("see [this one](#)");
  });

  it("renders a closed reference link optimistically while its definition is missing", () => {
    expect(preprocessPartialMarkdown("see [this one][missing]")).toBe("see [this one](#)");
  });

  it("keeps unresolved reference links rendered after the cursor moves on", () => {
    expect(preprocessPartialMarkdown("see [this one][missing].\n\nNext")).toBe("see [this one](#).\n\nNext");
  });

  it("keeps reference links resolvable while their definition title is incomplete", () => {
    const input = "see [this one][ref].\n\n[ref]: https://example.com \"Exam";
    expect(preprocessPartialMarkdown(input)).toBe("see [this one][ref].\n\n[ref]: https://example.com");
  });

  it("does not buffer when a matching reference definition exists", () => {
    const input = "see [this one][ref]\n\n[ref]: https://example.com";
    expect(preprocessPartialMarkdown(input)).toBe(input);
  });

  it("buffers a reference definition as soon as a used label starts streaming", () => {
    const input = "see [this one][ref]\n\n[re";
    expect(preprocessPartialMarkdown(input)).toBe("see [this one](#)\n\n");
  });

  it("buffers a reference definition until its URL starts", () => {
    const input = "see [this one][ref]\n\n[ref]:";
    expect(preprocessPartialMarkdown(input)).toBe("see [this one](#)\n\n");
  });

  it("keeps a reference definition valid while its quoted title is incomplete", () => {
    const input = "see [this one][ref]\n\n[ref]: https://example.com \"Exam";
    expect(preprocessPartialMarkdown(input)).toBe("see [this one][ref]\n\n[ref]: https://example.com");
  });

  it("keeps a reference definition unchanged once its quoted title is closed", () => {
    const input = "see [this one][ref]\n\n[ref]: https://example.com \"Example\"";
    expect(preprocessPartialMarkdown(input)).toBe(input);
  });

  it("keeps a parenthesized reference title valid while it is incomplete", () => {
    const input = "see [this one][ref]\n\n[ref]: https://example.com (Example";
    expect(preprocessPartialMarkdown(input)).toBe("see [this one][ref]\n\n[ref]: https://example.com");
  });

  it("commits the fence once its newline arrives", () => {
    expect(preprocessPartialMarkdown("```js\n")).toBe("```js\n");
  });
});
