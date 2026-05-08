import { afterEach, describe, expect, it } from "vitest";
import {
  type RendererDefinition,
  clearRegistry,
  getApprovalRenderer,
  getMessageRenderer,
  getRendererByKey,
  getToolRenderer,
  listMessageMatchers,
  listRegisteredKeys,
  registerRenderer,
  unregisterRenderer,
} from "../registry";

const noopTool = async () => ({ default: () => null });
const noopApproval = async () => ({ default: () => null });
const noopMessage = async () => ({ default: () => null });

afterEach(() => {
  clearRegistry();
});

describe("renderer registry", () => {
  it("registers and looks up by key", () => {
    const def: RendererDefinition = { key: "code", tool: noopTool };
    registerRenderer(def);
    expect(getRendererByKey("code")).toBe(def);
    expect(listRegisteredKeys()).toEqual(["code"]);
  });

  it("resolves aliases to canonical definition", () => {
    const def: RendererDefinition = {
      key: "document",
      aliases: ["markdown", "md"],
      tool: noopTool,
    };
    registerRenderer(def);
    expect(getRendererByKey("markdown")).toBe(def);
    expect(getRendererByKey("md")).toBe(def);
    expect(getRendererByKey("document")).toBe(def);
  });

  it("getToolRenderer returns entry only when tool field is present", () => {
    const withTool: RendererDefinition = { key: "with-tool", tool: noopTool };
    const withoutTool: RendererDefinition = { key: "no-tool", message: noopMessage };
    registerRenderer(withTool);
    registerRenderer(withoutTool);
    expect(getToolRenderer("with-tool")).toBe(withTool);
    expect(getToolRenderer("no-tool")).toBeUndefined();
  });

  it("getApprovalRenderer filters by approval field", () => {
    const def: RendererDefinition = { key: "approve", approval: noopApproval };
    const other: RendererDefinition = { key: "tool-only", tool: noopTool };
    registerRenderer(def);
    registerRenderer(other);
    expect(getApprovalRenderer("approve")).toBe(def);
    expect(getApprovalRenderer("tool-only")).toBeUndefined();
  });

  it("getMessageRenderer returns only message-role entries", () => {
    const messageDef: RendererDefinition = {
      key: "msg",
      message: noopMessage,
      matchMessage: () => [],
    };
    const toolDef: RendererDefinition = { key: "tool", tool: noopTool };
    registerRenderer(messageDef);
    registerRenderer(toolDef);
    expect(getMessageRenderer("msg")).toBe(messageDef);
    expect(getMessageRenderer("tool")).toBeUndefined();
  });

  it("listMessageMatchers returns only entries with both message and matchMessage", () => {
    const withMatcher: RendererDefinition = {
      key: "with-matcher",
      message: noopMessage,
      matchMessage: () => [],
    };
    const withoutMatcher: RendererDefinition = { key: "plain-msg", message: noopMessage };
    registerRenderer(withMatcher);
    registerRenderer(withoutMatcher);
    expect(listMessageMatchers()).toEqual([withMatcher]);
  });

  it("matches tool name patterns by string equality and regex", () => {
    const def: RendererDefinition = {
      key: "fs",
      toolNamePatterns: ["read_file", /^write_/],
      tool: noopTool,
    };
    registerRenderer(def);
    expect(getToolRenderer(undefined, "read_file")).toBe(def);
    expect(getToolRenderer(undefined, "write_text")).toBe(def);
    expect(getToolRenderer(undefined, "delete_file")).toBeUndefined();
  });

  it("first registered wins for overlapping patterns", () => {
    const builtin: RendererDefinition = {
      key: "builtin",
      toolNamePatterns: ["shared_tool"],
      tool: noopTool,
    };
    const plugin: RendererDefinition = {
      key: "plugin",
      toolNamePatterns: ["shared_tool"],
      tool: noopTool,
    };
    registerRenderer(builtin);
    registerRenderer(plugin);
    expect(getToolRenderer(undefined, "shared_tool")).toBe(builtin);
  });

  it("throws on duplicate key with different definition", () => {
    registerRenderer({ key: "dup", tool: noopTool });
    expect(() =>
      registerRenderer({ key: "dup", aliases: ["other"], tool: noopTool }),
    ).toThrow(/already registered/);
  });

  it("idempotent reregistration of structurally identical definition", () => {
    const def: RendererDefinition = {
      key: "stable",
      aliases: ["s"],
      toolNamePatterns: ["x", /^y$/],
      tool: noopTool,
    };
    registerRenderer(def);
    expect(() =>
      registerRenderer({
        key: "stable",
        aliases: ["s"],
        toolNamePatterns: ["x", /^y$/],
        tool: noopTool,
      }),
    ).not.toThrow();
  });

  it("throws on alias collision", () => {
    registerRenderer({ key: "first", aliases: ["shared"], tool: noopTool });
    expect(() =>
      registerRenderer({ key: "second", aliases: ["shared"], tool: noopTool }),
    ).toThrow(/already mapped/);
  });

  it("clearRegistry resets state", () => {
    registerRenderer({ key: "a", aliases: ["alpha"], tool: noopTool });
    registerRenderer({ key: "b", tool: noopTool });
    clearRegistry();
    expect(listRegisteredKeys()).toEqual([]);
    expect(getRendererByKey("a")).toBeUndefined();
    expect(getRendererByKey("alpha")).toBeUndefined();
  });

  it("unregisterRenderer removes entry and frees aliases", () => {
    registerRenderer({ key: "x", aliases: ["xx"], tool: noopTool });
    unregisterRenderer("x");
    expect(getRendererByKey("x")).toBeUndefined();
    expect(getRendererByKey("xx")).toBeUndefined();
    registerRenderer({ key: "y", aliases: ["xx"], tool: noopTool });
    expect(getRendererByKey("xx")?.key).toBe("y");
  });
});
