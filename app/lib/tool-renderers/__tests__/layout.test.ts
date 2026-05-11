import { afterEach, describe, expect, it } from "vitest";
import { clearRegistry, registerRenderer } from "@/lib/renderers";
import { shouldSkipConsecutiveToolBlock } from "../layout";
import type { ContentBlock } from "@/lib/types/chat";

const noopTool = async () => ({ default: () => null });

function tool(id: string, toolName: string): ContentBlock {
  return {
    type: "tool_call",
    id,
    toolName,
    toolArgs: {},
    isCompleted: true,
  };
}

afterEach(() => {
  clearRegistry();
});

describe("tool renderer layout", () => {
  it("skips earlier consecutive collapsible renderer blocks", () => {
    registerRenderer({
      key: "todo-list",
      toolNamePatterns: [/^TodoWrite$/],
      collapseConsecutive: true,
      layout: "standalone",
      tool: noopTool,
    });

    const blocks: ContentBlock[] = [tool("a", "TodoWrite"), tool("b", "TodoWrite")];

    expect(shouldSkipConsecutiveToolBlock(blocks, 0)).toBe(true);
    expect(shouldSkipConsecutiveToolBlock(blocks, 1)).toBe(false);
  });

  it("does not skip across meaningful content", () => {
    registerRenderer({
      key: "todo-list",
      toolNamePatterns: [/^TodoWrite$/],
      collapseConsecutive: true,
      layout: "standalone",
      tool: noopTool,
    });

    const blocks: ContentBlock[] = [
      tool("a", "TodoWrite"),
      { type: "text", content: "updated" },
      tool("b", "TodoWrite"),
    ];

    expect(shouldSkipConsecutiveToolBlock(blocks, 0)).toBe(false);
  });
});
