import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInitialState,
  processEvent,
} from "@/lib/services/stream-processor";
import { RUNTIME_EVENT } from "@/lib/services/runtime-events";
import { resetStreamProcessorWarningsForTests } from "@/lib/services/stream-processor-utils";
import type { ContentBlock } from "@/lib/types/chat";

function makeCallbacks() {
  const updates: ContentBlock[][] = [];
  const onEvent = vi.fn<(event: string, payload: Record<string, unknown>) => void>();
  const onThinkTagDetected = vi.fn();

  return {
    updates,
    onEvent,
    onThinkTagDetected,
    callbacks: {
      onUpdate: (content: ContentBlock[]) => {
        updates.push(content);
      },
      onEvent,
      onThinkTagDetected,
    },
  };
}

describe("stream-processor", () => {
  beforeEach(() => {
    resetStreamProcessorWarningsForTests();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("handles text and reasoning event family", () => {
    const state = createInitialState();
    const { callbacks, updates, onThinkTagDetected } = makeCallbacks();

    processEvent(RUNTIME_EVENT.RUN_CONTENT, { content: "hello <think>" }, state, callbacks);
    processEvent(RUNTIME_EVENT.REASONING_STARTED, {}, state, callbacks);
    processEvent(RUNTIME_EVENT.REASONING_STEP, { reasoningContent: "step-1" }, state, callbacks);
    processEvent(RUNTIME_EVENT.REASONING_COMPLETED, {}, state, callbacks);
    processEvent(RUNTIME_EVENT.RUN_CONTENT, { content: " world" }, state, callbacks);

    const lastUpdate = updates.at(-1) || [];

    expect(onThinkTagDetected).toHaveBeenCalledTimes(1);
    expect(lastUpdate).toEqual([
      { type: "text", content: "hello <think>" },
      { type: "reasoning", content: "step-1", isCompleted: true },
      { type: "text", content: " world" },
    ]);
  });

  it("handles tool lifecycle event family", () => {
    const state = createInitialState();
    const { callbacks, updates } = makeCallbacks();

    processEvent(
      RUNTIME_EVENT.TOOL_CALL_STARTED,
      { tool: { id: "tool-1", toolName: "search", toolArgs: { q: "abc" } } },
      state,
      callbacks,
    );
    processEvent(
      RUNTIME_EVENT.TOOL_CALL_COMPLETED,
      { tool: { id: "tool-1", toolName: "search", toolArgs: { q: "abc" }, toolResult: "done" } },
      state,
      callbacks,
    );

    const lastUpdate = updates.at(-1) || [];
    expect(lastUpdate).toEqual([
      {
        type: "tool_call",
        id: "tool-1",
        toolName: "search",
        toolArgs: { q: "abc" },
        toolResult: "done",
        isCompleted: true,
      },
    ]);
  });

  it("handles member-run event family", () => {
    const state = createInitialState();
    const { callbacks, updates } = makeCallbacks();

    processEvent(
      RUNTIME_EVENT.MEMBER_RUN_STARTED,
      { memberRunId: "m1", memberName: "Planner", task: "Plan" },
      state,
      callbacks,
    );
    processEvent(
      RUNTIME_EVENT.RUN_CONTENT,
      { memberRunId: "m1", memberName: "Planner", content: "thinking" },
      state,
      callbacks,
    );
    processEvent(
      RUNTIME_EVENT.TOOL_CALL_STARTED,
      {
        memberRunId: "m1",
        memberName: "Planner",
        tool: { id: "tool-m1", toolName: "calc", toolArgs: { x: 1 } },
      },
      state,
      callbacks,
    );
    processEvent(
      RUNTIME_EVENT.TOOL_CALL_COMPLETED,
      {
        memberRunId: "m1",
        memberName: "Planner",
        tool: {
          id: "tool-m1",
          toolName: "calc",
          toolArgs: { x: 1 },
          toolResult: "1",
        },
      },
      state,
      callbacks,
    );
    processEvent(RUNTIME_EVENT.MEMBER_RUN_COMPLETED, { memberRunId: "m1" }, state, callbacks);

    const lastUpdate = updates.at(-1) || [];
    expect(lastUpdate).toEqual([
      {
        type: "member_run",
        runId: "m1",
        memberName: "Planner",
        task: "Plan",
        content: [
          { type: "text", content: "thinking" },
          {
            type: "tool_call",
            id: "tool-m1",
            toolName: "calc",
            toolArgs: { x: 1 },
            toolResult: "1",
            isCompleted: true,
          },
        ],
        isCompleted: true,
      },
    ]);
  });

  it("preserves flow-node text boundary separation", () => {
    const state = createInitialState();
    const { callbacks, updates } = makeCallbacks();

    processEvent(RUNTIME_EVENT.RUN_CONTENT, { content: "alpha" }, state, callbacks);
    processEvent(RUNTIME_EVENT.FLOW_NODE_STARTED, {}, state, callbacks);
    processEvent(RUNTIME_EVENT.RUN_CONTENT, { content: "beta" }, state, callbacks);
    processEvent(RUNTIME_EVENT.RUN_COMPLETED, {}, state, callbacks);

    const lastUpdate = updates.at(-1) || [];
    expect(lastUpdate).toEqual([
      { type: "text", content: "alpha" },
      { type: "text", content: "beta" },
    ]);
  });

  it("passes unknown events through onEvent and warns once", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const state = createInitialState();
    const { callbacks, updates, onEvent } = makeCallbacks();

    processEvent("CustomAgentEvent", { foo: 1 }, state, callbacks);
    processEvent("CustomAgentEvent", { foo: 2 }, state, callbacks);

    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent).toHaveBeenNthCalledWith(1, "CustomAgentEvent", { foo: 1 });
    expect(onEvent).toHaveBeenNthCalledWith(2, "CustomAgentEvent", { foo: 2 });
    expect(updates).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
