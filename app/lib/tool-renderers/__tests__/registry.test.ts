import { describe, expect, it } from "vitest";
import { listRegisteredKeys, getRendererByKey } from "@/lib/renderers";
import { getToolCallRenderer, getToolCallRendererDisplay } from "../registry";

describe("tool-renderers registry wiring", () => {
  it("registers the six built-in renderers via the unified registry", () => {
    const keys = listRegisteredKeys();
    for (const key of ["default", "code", "document", "html", "frame", "editor"]) {
      expect(keys).toContain(key);
    }
  });

  it("exposes 'markdown' as alias for the document renderer", () => {
    const def = getRendererByKey("markdown");
    expect(def?.key).toBe("document");
  });

  it("resolves each built-in key to a loadable component", async () => {
    for (const key of ["default", "code", "document", "html", "frame", "editor"]) {
      const renderer = await getToolCallRenderer(key);
      expect(typeof renderer).toBe("function");
    }
  });

  it("falls back to the default renderer for unknown keys", async () => {
    const def = await getToolCallRenderer("does-not-exist");
    const fallback = await getToolCallRenderer("default");
    expect(def).toBe(fallback);
  });

  it("resolves renderer by tool name when no render plan is stored", async () => {
    const byKey = await getToolCallRenderer("task");
    const byToolName = await getToolCallRenderer(undefined, "Task");
    expect(byToolName).toBe(byKey);
  });

  it("exposes default-renderer display metadata by tool name", () => {
    expect(getToolCallRendererDisplay(undefined, "LS")).toEqual({
      title: "ls {directory_path}",
      icon: "folder",
    });
  });
});
