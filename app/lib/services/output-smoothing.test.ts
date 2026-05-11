import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutputSmoothingController } from "@/lib/services/output-smoothing";
import type { ContentBlock } from "@/lib/types/chat";

interface AnimationFrameController {
  flushAt: (timestamp: number) => void;
  pendingCount: () => number;
}

function installAnimationFrameController(): AnimationFrameController {
  const queue: FrameRequestCallback[] = [];
  let frameId = 0;

  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    queue.push(cb);
    frameId += 1;
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    void id;
  });

  return {
    flushAt: (timestamp: number) => {
      const callback = queue.shift();
      callback?.(timestamp);
    },
    pendingCount: () => queue.length,
  };
}

function textOf(blocks: ContentBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "text" || block.type === "reasoning") return block.content;
      if (block.type === "member_run") return textOf(block.content);
      return "";
    })
    .join("");
}

describe("OutputSmoothingController", () => {
  let animationFrame: AnimationFrameController;

  beforeEach(() => {
    vi.spyOn(globalThis.performance, "now").mockReturnValue(0);
    animationFrame = installAnimationFrameController();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reveals text content progressively", () => {
    const updates: ContentBlock[][] = [];
    const controller = new OutputSmoothingController((content) => updates.push(content));
    const content = "abcdefghijklmnopqrstuvwxyz";

    controller.update([{ type: "text", content }]);
    animationFrame.flushAt(220);

    const block = updates.at(-1)?.[0];
    expect(block?.type).toBe("text");
    if (block?.type !== "text") return;
    const visible = textOf(updates.at(-1) ?? []);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan(content.length);
    expect(block.lookaheadContent).toBe(content);
    expect(block.visibleChars).toBe(visible.length);

    controller.dispose();
  });

  it("finishes pending text within the final smoothing deadline", async () => {
    const updates: ContentBlock[][] = [];
    const controller = new OutputSmoothingController((content) => updates.push(content));
    const content = "x".repeat(1200);

    const finished = controller.finish([{ type: "text", content }]);
    expect(animationFrame.pendingCount()).toBe(1);

    animationFrame.flushAt(601);
    await finished;

    expect(textOf(updates.at(-1) ?? [])).toBe(content);
  });

  it("delays tool blocks until preceding text is revealed", () => {
    const updates: ContentBlock[][] = [];
    const controller = new OutputSmoothingController((content) => updates.push(content));

    controller.update([
      {
        type: "member_run",
        runId: "run-1",
        memberName: "Worker",
        content: [
          { type: "text", content: "nested response" },
          {
            type: "tool_call",
            id: "tool-1",
            toolName: "search",
            toolArgs: {},
            isCompleted: true,
          },
        ],
        isCompleted: false,
      },
    ]);
    animationFrame.flushAt(220);

    const lastUpdate = updates.at(-1) ?? [];
    const member = lastUpdate[0];
    expect(member?.type).toBe("member_run");
    if (member?.type !== "member_run") return;
    expect(member.content.some((block) => block.type === "tool_call")).toBe(false);
    const visible = textOf(member.content);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan("nested response".length);

    controller.dispose();
  });

  it("keeps reasoning active until its visible text catches up", async () => {
    const updates: ContentBlock[][] = [];
    const controller = new OutputSmoothingController((content) => updates.push(content));
    const content = "thinking ".repeat(40);
    const blocks: ContentBlock[] = [{ type: "reasoning", content, isCompleted: true }];

    controller.update(blocks);
    animationFrame.flushAt(220);

    const partialBlock = updates.at(-1)?.[0];
    expect(partialBlock?.type).toBe("reasoning");
    if (partialBlock?.type !== "reasoning") return;
    expect(partialBlock.isCompleted).toBe(false);

    const finished = controller.finish(blocks);
    animationFrame.flushAt(601);
    await finished;

    const finalBlock = updates.at(-1)?.[0];
    expect(finalBlock?.type).toBe("reasoning");
    if (finalBlock?.type !== "reasoning") return;
    expect(finalBlock.isCompleted).toBe(true);

    controller.dispose();
  });

  it("smooths subsequent bursts after catching up", async () => {
    const updates: ContentBlock[][] = [];
    const controller = new OutputSmoothingController((content) => updates.push(content));

    const first = "a".repeat(200);
    const firstDone = controller.finish([{ type: "text", content: first }]);
    animationFrame.flushAt(601);
    await firstDone;

    const second = first + "b".repeat(200);
    controller.update([{ type: "text", content: second }]);
    animationFrame.flushAt(220);

    const visible = textOf(updates.at(-1) ?? []);
    expect(visible.length).toBeGreaterThan(first.length);
    expect(visible.length).toBeLessThan(second.length);

    controller.dispose();
  });
});
