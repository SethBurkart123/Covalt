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
    const content = "Hello **world**";
    const segments = parseMessageSegments(content);
    expect(segments).toEqual([
      { kind: "markdown", start: 0, end: content.length, text: content },
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
    const rendererText = "<system-reminder>note</system-reminder>";
    const rendererStart = content.indexOf(rendererText);
    const rendererEnd = rendererStart + rendererText.length;
    const segments = parseMessageSegments(content);
    expect(segments).toEqual([
      { kind: "markdown", start: 0, end: rendererStart, text: "before " },
      {
        kind: "renderer",
        start: rendererStart,
        end: rendererEnd,
        rendererKey: "system-reminder",
        config: { body: "note" },
      },
      { kind: "markdown", start: rendererEnd, end: content.length, text: " after" },
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
      start: content.indexOf("<alpha>a</alpha>"),
      end: content.indexOf("<alpha>a</alpha>") + "<alpha>a</alpha>".length,
      rendererKey: "alpha",
      config: { body: "a" },
    });
    expect(segments[3]).toEqual({
      kind: "renderer",
      start: content.indexOf("<beta>b</beta>"),
      end: content.indexOf("<beta>b</beta>") + "<beta>b</beta>".length,
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
        start: 0,
        end: 20,
        rendererKey: "outer",
        config: { tag: "outer" },
      },
      { kind: "markdown", start: 20, end: content.length, text: content.slice(20) },
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
    const firstTag = "<tag>a</tag>";
    const secondTag = "<tag>b</tag>";
    expect(segments).toEqual([
      { kind: "renderer", start: 0, end: firstTag.length, rendererKey: "tag", config: { body: "a" } },
      { kind: "renderer", start: firstTag.length, end: firstTag.length + secondTag.length, rendererKey: "tag", config: { body: "b" } },
    ]);
  });
});
