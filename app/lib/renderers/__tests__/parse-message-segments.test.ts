import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearRegistry,
  registerRenderer,
  type RendererDefinition,
} from "../registry";
import type { MessageRendererMatch } from "../types";
import { parseMessageSegments } from "../parse-message-segments";

const noopMessage = async () => ({ default: () => null });

function makeDef(
  key: string,
  matchMessage: (content: string) => MessageRendererMatch[],
): RendererDefinition {
  return { key, message: noopMessage, matchMessage };
}

function regexMatcher(
  pattern: RegExp,
): (content: string) => MessageRendererMatch[] {
  return (content) => {
    const out: MessageRendererMatch[] = [];
    for (const m of content.matchAll(pattern)) {
      if (m.index === undefined) continue;
      out.push({
        start: m.index,
        end: m.index + m[0].length,
        config: { body: m[1] ?? "" },
      });
    }
    return out;
  };
}

beforeEach(() => {
  clearRegistry();
});

afterEach(() => {
  clearRegistry();
});

describe("parseMessageSegments", () => {
  it("returns empty list for empty content", () => {
    expect(parseMessageSegments("")).toEqual([]);
  });

  it("returns a single markdown segment for plain content", () => {
    registerRenderer(
      makeDef("never", regexMatcher(/<never>([\s\S]*?)<\/never>/g)),
    );
    const segments = parseMessageSegments("Hello **world**");
    expect(segments).toEqual([
      { kind: "markdown", text: "Hello **world**" },
    ]);
  });

  it("splits a single match into markdown / renderer / markdown", () => {
    registerRenderer(
      makeDef(
        "system-reminder",
        regexMatcher(/<system-reminder>([\s\S]*?)<\/system-reminder>/g),
      ),
    );
    const content = "before <system-reminder>note</system-reminder> after";
    const segments = parseMessageSegments(content);
    expect(segments).toEqual([
      { kind: "markdown", text: "before " },
      {
        kind: "renderer",
        rendererKey: "system-reminder",
        config: { body: "note" },
      },
      { kind: "markdown", text: " after" },
    ]);
  });

  it("supports multiple non-overlapping matchers", () => {
    registerRenderer(
      makeDef("alpha", regexMatcher(/<alpha>([\s\S]*?)<\/alpha>/g)),
    );
    registerRenderer(
      makeDef("beta", regexMatcher(/<beta>([\s\S]*?)<\/beta>/g)),
    );
    const content = "x <alpha>a</alpha> y <beta>b</beta> z";
    const segments = parseMessageSegments(content);
    expect(segments.map((s) => s.kind)).toEqual([
      "markdown",
      "renderer",
      "markdown",
      "renderer",
      "markdown",
    ]);
    expect(segments[1]).toEqual({
      kind: "renderer",
      rendererKey: "alpha",
      config: { body: "a" },
    });
    expect(segments[3]).toEqual({
      kind: "renderer",
      rendererKey: "beta",
      config: { body: "b" },
    });
  });

  it("first match wins on overlap; later overlapping match is discarded", () => {
    registerRenderer(
      makeDef("outer", () => [
        { start: 0, end: 20, config: { tag: "outer" } },
      ]),
    );
    registerRenderer(
      makeDef("inner", () => [
        { start: 5, end: 10, config: { tag: "inner" } },
      ]),
    );
    const content = "abcdefghijklmnopqrstuvwxyz";
    const segments = parseMessageSegments(content);
    expect(segments).toEqual([
      {
        kind: "renderer",
        rendererKey: "outer",
        config: { tag: "outer" },
      },
      { kind: "markdown", text: content.slice(20) },
    ]);
  });

  it("does not emit empty markdown segments at boundaries", () => {
    registerRenderer(
      makeDef(
        "tag",
        regexMatcher(/<tag>([\s\S]*?)<\/tag>/g),
      ),
    );
    const content = "<tag>a</tag><tag>b</tag>";
    const segments = parseMessageSegments(content);
    expect(segments).toEqual([
      { kind: "renderer", rendererKey: "tag", config: { body: "a" } },
      { kind: "renderer", rendererKey: "tag", config: { body: "b" } },
    ]);
  });
});
