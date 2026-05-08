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

interface AnimationFrameController {
  flushAll: () => void;
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

  return {
    flushAll: () => {
      while (queue.length > 0) {
        const callback = queue.shift();
        callback?.(0);
      }
    },
    pendingCount: () => queue.length,
  };
}

describe("stream-processor", () => {
  let animationFrame: AnimationFrameController;

  beforeEach(() => {
    resetStreamProcessorWarningsForTests();
    animationFrame = installAnimationFrameController();
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

    animationFrame.flushAll();
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

    animationFrame.flushAll();
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

    animationFrame.flushAll();
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

    animationFrame.flushAll();
    const lastUpdate = updates.at(-1) || [];
    expect(lastUpdate).toEqual([
      { type: "text", content: "alpha" },
      { type: "text", content: "beta" },
    ]);
  });

  it("passes unknown events through onEvent and warns once per event type", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const state = createInitialState();
    const { callbacks, updates, onEvent } = makeCallbacks();

    processEvent("CustomAgentEvent", { foo: 1 }, state, callbacks);
    processEvent("AnotherUnknownEvent", { bar: 2 }, state, callbacks);
    processEvent("CustomAgentEvent", { foo: 3 }, state, callbacks);

    expect(onEvent).toHaveBeenCalledTimes(3);
    expect(onEvent).toHaveBeenNthCalledWith(1, "CustomAgentEvent", { foo: 1 });
    expect(onEvent).toHaveBeenNthCalledWith(2, "AnotherUnknownEvent", { bar: 2 });
    expect(onEvent).toHaveBeenNthCalledWith(3, "CustomAgentEvent", { foo: 3 });
    expect(updates).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenNthCalledWith(
      1,
      "StreamProcessor unknown runtime event CustomAgentEvent: {\"foo\":1}",
    );
    expect(warnSpy).toHaveBeenNthCalledWith(
      2,
      "StreamProcessor unknown runtime event AnotherUnknownEvent: {\"bar\":2}",
    );
  });

  it("does not schedule UI updates for unknown runtime events", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const state = createInitialState();
    const { callbacks } = makeCallbacks();

    processEvent("CustomAgentEvent", { foo: 1 }, state, callbacks);

    expect(animationFrame.pendingCount()).toBe(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps member-scoped approval updates ordered and removes resolved member tool blocks", () => {
    const state = createInitialState();
    const { callbacks, updates } = makeCallbacks();

    processEvent(
      RUNTIME_EVENT.MEMBER_RUN_STARTED,
      { memberRunId: "m1", memberName: "Planner", task: "Plan" },
      state,
      callbacks,
    );
    processEvent(
      RUNTIME_EVENT.APPROVAL_REQUIRED,
      {
        memberRunId: "m1",
        tool: {
          runId: "run-1",
          requestId: "req-1",
          tools: [{ id: "tool-1", toolName: "search", toolArgs: { q: "a" } }],
        },
      },
      state,
      callbacks,
    );

    animationFrame.flushAll();
    const pendingUpdate = updates.at(-1) || [];
    expect(pendingUpdate).toHaveLength(1);

    const pendingMemberRun = pendingUpdate[0];
    expect(pendingMemberRun).toMatchObject({
      type: "member_run",
      runId: "m1",
      memberName: "Planner",
      isCompleted: false,
    });

    if (!pendingMemberRun || pendingMemberRun.type !== "member_run") {
      throw new Error("expected update block to be member_run");
    }

    expect(pendingMemberRun.content).toHaveLength(1);
    expect(pendingMemberRun.content[0]).toMatchObject({
      type: "tool_call",
      id: "tool-1",
      toolName: "search",
      toolArgs: { q: "a" },
      approvalStatus: "pending",
      isCompleted: false,
    });

    processEvent(
      RUNTIME_EVENT.APPROVAL_RESOLVED,
      {
        memberRunId: "m1",
        tool: {
          runId: "run-1",
          requestId: "req-1",
          selectedOption: "deny",
          tools: [
            {
              id: "tool-1",
              toolName: "search",
              toolArgs: { q: "a" },
              approvalStatus: "denied",
            },
          ],
        },
      },
      state,
      callbacks,
    );

    animationFrame.flushAll();
    const resolvedUpdate = updates.at(-1) || [];
    expect(resolvedUpdate).toHaveLength(1);

    const resolvedMemberRun = resolvedUpdate[0];
    if (!resolvedMemberRun || resolvedMemberRun.type !== "member_run") {
      throw new Error("expected resolved update to contain only the member_run block");
    }

    expect(resolvedMemberRun.content).toHaveLength(1);
    expect(resolvedMemberRun.content[0]).toMatchObject({
      type: "tool_call",
      id: "tool-1",
      approvalStatus: "denied",
      isCompleted: true,
    });
    expect(animationFrame.pendingCount()).toBe(0);
  });

  it("emits fresh member_run references on each update so React picks up in-place mutations", () => {
    const state = createInitialState();
    const { callbacks, updates } = makeCallbacks();

    processEvent(
      RUNTIME_EVENT.MEMBER_RUN_STARTED,
      { memberRunId: "sub-1", memberName: "Researcher A", task: "task-a" },
      state,
      callbacks,
    );
    processEvent(
      RUNTIME_EVENT.MEMBER_RUN_STARTED,
      { memberRunId: "sub-2", memberName: "Researcher B", task: "task-b" },
      state,
      callbacks,
    );
    animationFrame.flushAll();
    const initialUpdate = updates.at(-1) || [];
    expect(initialUpdate).toHaveLength(2);
    const initialSub1 = initialUpdate[0];
    const initialSub2 = initialUpdate[1];
    if (
      !initialSub1 ||
      initialSub1.type !== "member_run" ||
      !initialSub2 ||
      initialSub2.type !== "member_run"
    ) {
      throw new Error("expected two member_run blocks in initial update");
    }
    expect(initialSub1.content).toHaveLength(0);
    expect(initialSub2.content).toHaveLength(0);

    processEvent(
      RUNTIME_EVENT.APPROVAL_REQUIRED,
      {
        memberRunId: "sub-1",
        tool: {
          runId: "sub-1",
          requestId: "req-sub-1",
          tools: [{ id: "tool-a", toolName: "search", toolArgs: { q: "agno" } }],
        },
      },
      state,
      callbacks,
    );
    processEvent(
      RUNTIME_EVENT.APPROVAL_REQUIRED,
      {
        memberRunId: "sub-2",
        tool: {
          runId: "sub-2",
          requestId: "req-sub-2",
          tools: [{ id: "tool-b", toolName: "search", toolArgs: { q: "teams" } }],
        },
      },
      state,
      callbacks,
    );
    animationFrame.flushAll();

    const finalUpdate = updates.at(-1) || [];
    expect(finalUpdate).toHaveLength(2);
    const finalSub1 = finalUpdate[0];
    const finalSub2 = finalUpdate[1];
    if (
      !finalSub1 ||
      finalSub1.type !== "member_run" ||
      !finalSub2 ||
      finalSub2.type !== "member_run"
    ) {
      throw new Error("expected two member_run blocks in final update");
    }

    // React relies on referential changes; both the block and its content array
    // must have fresh refs once an inner mutation happens.
    expect(finalSub1).not.toBe(initialSub1);
    expect(finalSub2).not.toBe(initialSub2);
    expect(finalSub1.content).not.toBe(initialSub1.content);
    expect(finalSub2.content).not.toBe(initialSub2.content);

    expect(finalSub1.content).toHaveLength(1);
    expect(finalSub1.content[0]).toMatchObject({
      type: "tool_call",
      id: "tool-a",
      approvalStatus: "pending",
      isCompleted: false,
    });
    expect(finalSub2.content).toHaveLength(1);
    expect(finalSub2.content[0]).toMatchObject({
      type: "tool_call",
      id: "tool-b",
      approvalStatus: "pending",
      isCompleted: false,
    });
  });

  it("appends tool call progress entries onto the matching tool block", () => {
    const state = createInitialState();
    const { callbacks, updates } = makeCallbacks();

    processEvent(
      RUNTIME_EVENT.TOOL_CALL_STARTED,
      { tool: { id: "t-progress", toolName: "exec", toolArgs: { command: "ls" } } },
      state,
      callbacks,
    );
    processEvent(
      RUNTIME_EVENT.TOOL_CALL_PROGRESS,
      {
        progress: {
          toolCallId: "t-progress",
          kind: "stdout",
          detail: "line 1\n",
          progress: 0.25,
        },
      },
      state,
      callbacks,
    );
    processEvent(
      RUNTIME_EVENT.TOOL_CALL_PROGRESS,
      {
        progress: {
          toolCallId: "t-progress",
          kind: "stdout",
          detail: "line 2\n",
        },
      },
      state,
      callbacks,
    );

    animationFrame.flushAll();
    const lastUpdate = updates.at(-1) || [];
    expect(lastUpdate).toHaveLength(1);
    const block = lastUpdate[0];
    if (!block || block.type !== "tool_call") throw new Error("expected tool_call");
    expect(block.progress).toHaveLength(2);
    expect(block.progress?.[0]?.detail).toBe("line 1\n");
    expect(block.progress?.[1]?.detail).toBe("line 2\n");
  });

  it("records working state and token usage on the stream state", () => {
    const state = createInitialState();
    const { callbacks } = makeCallbacks();

    processEvent(
      RUNTIME_EVENT.WORKING_STATE_CHANGED,
      { state: "executing_tool" },
      state,
      callbacks,
    );
    processEvent(
      RUNTIME_EVENT.TOKEN_USAGE,
      {
        tokenUsage: {
          inputTokens: 12,
          outputTokens: 4,
          cacheReadTokens: 1,
          cacheWriteTokens: 2,
        },
      },
      state,
      callbacks,
    );

    expect(state.messageState).toBe("executing_tool");
    expect(state.messageTokenUsage).toEqual({
      inputTokens: 12,
      outputTokens: 4,
      cacheReadTokens: 1,
      cacheWriteTokens: 2,
    });
  });

  it("appends a system_event content block for stream warnings", () => {
    const state = createInitialState();
    const { callbacks, updates } = makeCallbacks();

    processEvent(
      RUNTIME_EVENT.STREAM_WARNING,
      { warning: { message: "reconnecting", level: "warning" } },
      state,
      callbacks,
    );

    animationFrame.flushAll();
    const lastUpdate = updates.at(-1) || [];
    const systemEvent = lastUpdate.find((b) => b.type === "system_event");
    expect(systemEvent).toBeDefined();
    if (!systemEvent || systemEvent.type !== "system_event") throw new Error("expected system_event");
    expect(systemEvent.content).toBe("reconnecting");
    expect(systemEvent.level).toBe("warning");
  });
});
