"use client";

import type { ContentBlock } from "@/lib/types/chat";

interface ToolData {
  id: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolResult?: string;
  renderer?: string;
  editableArgs?: string[] | boolean;
  approvalStatus?: string;
}

interface ToolApprovalData {
  runId: string;
  tools: ToolData[];
}

interface MemberBuffers {
  currentTextBlock: string;
  currentReasoningBlock: string;
}

export interface StreamCallbacks {
  onUpdate: (content: ContentBlock[]) => void;
  onSessionId?: (sessionId: string) => void;
  onMessageId?: (messageId: string) => void;
  onThinkTagDetected?: () => void;
  onEvent?: (eventType: string, payload: Record<string, unknown>) => void;
}

export interface StreamState {
  contentBlocks: ContentBlock[];
  currentTextBlock: string;
  currentReasoningBlock: string;
  thinkTagDetected: boolean;
  memberStates: Map<string, MemberBuffers>;
  textBlockBoundary: boolean;
}

export function createInitialState(): StreamState {
  return {
    contentBlocks: [],
    currentTextBlock: "",
    currentReasoningBlock: "",
    thinkTagDetected: false,
    memberStates: new Map(),
    textBlockBoundary: false,
  };
}

function flushTextBlock(state: StreamState): void {
  if (state.currentTextBlock) {
    state.contentBlocks.push({ type: "text", content: state.currentTextBlock });
    state.currentTextBlock = "";
  }
}

function flushReasoningBlock(state: StreamState): void {
  if (state.currentReasoningBlock) {
    state.contentBlocks.push({
      type: "reasoning",
      content: state.currentReasoningBlock,
      isCompleted: true,
    });
    state.currentReasoningBlock = "";
  }
}

type MemberRunBlock = Extract<ContentBlock, { type: "member_run" }>;

function findMemberBlock(state: StreamState, runId: string): MemberRunBlock | null {
  for (let i = state.contentBlocks.length - 1; i >= 0; i--) {
    const b = state.contentBlocks[i];
    if (b.type === "member_run" && b.runId === runId) return b;
  }
  return null;
}

function getMemberState(state: StreamState, runId: string): MemberBuffers {
  let ms = state.memberStates.get(runId);
  if (!ms) {
    ms = { currentTextBlock: "", currentReasoningBlock: "" };
    state.memberStates.set(runId, ms);
  }
  return ms;
}

function flushMemberText(block: MemberRunBlock, ms: MemberBuffers): void {
  if (ms.currentTextBlock) {
    block.content.push({ type: "text", content: ms.currentTextBlock });
    ms.currentTextBlock = "";
  }
}

function flushMemberReasoning(block: MemberRunBlock, ms: MemberBuffers): void {
  if (ms.currentReasoningBlock) {
    block.content.push({
      type: "reasoning",
      content: ms.currentReasoningBlock,
      isCompleted: true,
    });
    ms.currentReasoningBlock = "";
  }
}

function buildCurrentContent(state: StreamState): ContentBlock[] {
  const content: ContentBlock[] = [];

  for (const block of state.contentBlocks) {
    if (block.type === "member_run") {
      const ms = state.memberStates.get(block.runId);
      if (ms && (ms.currentTextBlock || ms.currentReasoningBlock)) {
        const cloned: MemberRunBlock = { ...block, content: [...block.content] };
        if (ms.currentTextBlock) {
          cloned.content.push({ type: "text", content: ms.currentTextBlock });
        }
        if (ms.currentReasoningBlock) {
          cloned.content.push({
            type: "reasoning",
            content: ms.currentReasoningBlock,
            isCompleted: false,
          });
        }
        content.push(cloned);
      } else {
        content.push(block);
      }
    } else {
      content.push(block);
    }
  }

  if (state.currentTextBlock) {
    content.push({ type: "text", content: state.currentTextBlock });
  }
  if (state.currentReasoningBlock) {
    content.push({
      type: "reasoning",
      content: state.currentReasoningBlock,
      isCompleted: false,
    });
  }
  if (content.length === 0) {
    content.push({ type: "text", content: "" });
  }

  return content;
}

function scheduleUpdate(state: StreamState, onUpdate: (content: ContentBlock[]) => void): void {
  requestAnimationFrame(() => onUpdate(buildCurrentContent(state)));
}

function handleRunContent(state: StreamState, content: string, callbacks: StreamCallbacks): void {
  if (state.currentReasoningBlock && !state.currentTextBlock) {
    flushReasoningBlock(state);
  }

  if (!state.textBlockBoundary && state.currentTextBlock === "" && state.contentBlocks.length > 0) {
    const last = state.contentBlocks[state.contentBlocks.length - 1];
    if (last?.type === "text") {
      state.contentBlocks.pop();
      state.currentTextBlock = last.content || "";
    }
  }

  state.currentTextBlock += content;
  if (state.textBlockBoundary) {
    state.textBlockBoundary = false;
  }

  if (!state.thinkTagDetected && state.currentTextBlock.includes("<think>")) {
    state.thinkTagDetected = true;
    callbacks.onThinkTagDetected?.();
  }
}

function handleToolCallStarted(state: StreamState, tool: unknown): void {
  flushTextBlock(state);
  flushReasoningBlock(state);

  const t = tool as ToolData;
  const existingBlock = state.contentBlocks.find(
    (b) => b.type === "tool_call" && b.id === t.id,
  );

  if (existingBlock && existingBlock.type === "tool_call") {
    existingBlock.isCompleted = false;
  } else {
    state.contentBlocks.push({
      type: "tool_call",
      id: t.id,
      toolName: t.toolName,
      toolArgs: t.toolArgs,
      isCompleted: false,
    });
  }
}

function handleToolApprovalRequired(state: StreamState, toolData: unknown): void {
  flushTextBlock(state);
  flushReasoningBlock(state);

  const data = toolData as ToolApprovalData;
  const { runId, tools } = data;

  for (const tool of tools) {
    const block: ContentBlock = {
      type: "tool_call",
      id: tool.id,
      toolName: tool.toolName,
      toolArgs: tool.toolArgs,
      isCompleted: false,
      requiresApproval: true,
      runId: runId,
      toolCallId: tool.id,
      approvalStatus: "pending",
      editableArgs: tool.editableArgs,
    };
    state.contentBlocks.push(block);
  }
}

function handleToolCallCompleted(state: StreamState, tool: unknown): void {
  const t = tool as ToolData;
  const toolBlock = state.contentBlocks.find(
    (b) => b.type === "tool_call" && b.id === t.id,
  );

  if (!toolBlock || toolBlock.type !== "tool_call") return;

  toolBlock.toolResult = t.toolResult;
  toolBlock.isCompleted = true;
  if (toolBlock.requiresApproval && toolBlock.approvalStatus === "pending") {
    toolBlock.approvalStatus = "approved";
  }
  if (t.renderer) {
    toolBlock.renderer = t.renderer;
  }
}

function handleToolApprovalResolved(state: StreamState, tool: unknown): void {
  const t = tool as ToolData;
  const toolBlock = state.contentBlocks.find(
    (b) => b.type === "tool_call" && b.id === t.id,
  );

  if (!toolBlock || toolBlock.type !== "tool_call") return;

  toolBlock.approvalStatus = t.approvalStatus as "pending" | "approved" | "denied" | "timeout" | undefined;
  if (t.toolArgs) {
    toolBlock.toolArgs = t.toolArgs;
  }
  if (t.approvalStatus === "denied" || t.approvalStatus === "timeout") {
    toolBlock.isCompleted = true;
  }
}

function processMemberEvent(
  eventType: string,
  d: Record<string, unknown>,
  state: StreamState,
): void {
  const runId = d.memberRunId as string;
  const memberName = (d.memberName as string) || "Agent";

  let block = findMemberBlock(state, runId);
  if (!block) {
    block = {
      type: "member_run",
      runId,
      memberName,
      content: [],
      isCompleted: false,
      task: (d.task as string) || "",
    };
    state.contentBlocks.push(block);
  }

  if (memberName && memberName !== "Agent") {
    block.memberName = memberName;
  }

  const ms = getMemberState(state, runId);

  switch (eventType) {
    case "RunContent": {
      const text = (d.content as string) || "";
      if (ms.currentReasoningBlock && !ms.currentTextBlock) {
        flushMemberReasoning(block, ms);
      }
      ms.currentTextBlock += text;
      break;
    }

    case "ReasoningStarted":
      flushMemberText(block, ms);
      break;

    case "ReasoningStep": {
      const text = (d.reasoningContent as string) || "";
      if (text) {
        if (ms.currentTextBlock && !ms.currentReasoningBlock) {
          flushMemberText(block, ms);
        }
        ms.currentReasoningBlock += text;
      }
      break;
    }

    case "ReasoningCompleted":
      flushMemberReasoning(block, ms);
      break;

    case "ToolCallStarted": {
      flushMemberText(block, ms);
      flushMemberReasoning(block, ms);
      const t = d.tool as ToolData;
      const existing = block.content.find(
        (b): b is Extract<ContentBlock, { type: "tool_call" }> =>
          b.type === "tool_call" && b.id === t.id,
      );
      if (existing) {
        existing.toolName = t.toolName || existing.toolName;
        existing.toolArgs = t.toolArgs || existing.toolArgs;
        existing.isCompleted = false;
      } else {
        block.content.push({
          type: "tool_call",
          id: t.id,
          toolName: t.toolName,
          toolArgs: t.toolArgs,
          isCompleted: false,
        });
      }
      break;
    }

    case "ToolCallCompleted": {
      const t = d.tool as ToolData;
      const tc = block.content.find(
        (b): b is Extract<ContentBlock, { type: "tool_call" }> =>
          b.type === "tool_call" && b.id === t.id,
      );
      if (tc) {
        tc.isCompleted = true;
        tc.toolResult = t.toolResult;
      }
      break;
    }

    case "ToolApprovalRequired": {
      flushMemberText(block, ms);
      flushMemberReasoning(block, ms);
      const payload = d.tool as ToolApprovalData;
      const tools = payload?.tools || [];
      for (const tool of tools) {
        block.content.push({
          type: "tool_call",
          id: tool.id,
          toolName: tool.toolName,
          toolArgs: tool.toolArgs,
          isCompleted: false,
          requiresApproval: true,
          runId: payload?.runId,
          toolCallId: tool.id,
          approvalStatus: "pending",
          editableArgs: tool.editableArgs,
        });
      }
      break;
    }

    case "ToolApprovalResolved": {
      const t = d.tool as ToolData;
      const tc = block.content.find(
        (b): b is Extract<ContentBlock, { type: "tool_call" }> =>
          b.type === "tool_call" && b.id === t.id,
      );
      if (tc) {
        tc.approvalStatus = t.approvalStatus as "pending" | "approved" | "denied" | "timeout" | undefined;
        if (t.toolArgs) {
          tc.toolArgs = t.toolArgs;
        }
        if (t.approvalStatus === "denied" || t.approvalStatus === "timeout") {
          tc.isCompleted = true;
        }
      }
      break;
    }

    case "RunError":
    case "MemberRunError": {
      flushMemberText(block, ms);
      flushMemberReasoning(block, ms);
      const errorContent = (d.content as string) || (d.error as string) || "Agent encountered an error.";
      block.content.push({ type: "error", content: errorContent });
      block.isCompleted = true;
      block.hasError = true;
      state.memberStates.delete(runId);
      break;
    }
  }
}

function handleMemberRunStarted(state: StreamState, d: Record<string, unknown>): void {
  flushTextBlock(state);
  flushReasoningBlock(state);

  const runId = (d.memberRunId as string) || "";
  const memberName = (d.memberName as string) || "Agent";
  const task = (d.task as string) || "";

  if (runId && findMemberBlock(state, runId)) return;

  state.contentBlocks.push({
    type: "member_run",
    runId,
    memberName,
    content: [],
    isCompleted: false,
    task,
  });
  getMemberState(state, runId);
}

function handleMemberRunCompleted(state: StreamState, d: Record<string, unknown>): void {
  const runId = (d.memberRunId as string) || "";

  if (runId) {
    const block = findMemberBlock(state, runId);
    if (block) {
      const ms = getMemberState(state, runId);
      flushMemberText(block, ms);
      flushMemberReasoning(block, ms);
      block.isCompleted = true;
      state.memberStates.delete(runId);
    }
  } else {
    for (const b of state.contentBlocks) {
      if (b.type === "member_run" && !b.isCompleted) {
        const ms = state.memberStates.get(b.runId);
        if (ms) {
          flushMemberText(b, ms);
          flushMemberReasoning(b, ms);
          state.memberStates.delete(b.runId);
        }
        b.isCompleted = true;
      }
    }
  }
}

export function processEvent(
  eventType: string,
  data: unknown,
  state: StreamState,
  callbacks: StreamCallbacks,
): void {
  const d = (typeof data === "object" && data !== null
    ? data
    : { content: data }) as Record<string, unknown>;

  callbacks.onEvent?.(eventType, d);

  if (d.memberRunId && eventType !== "MemberRunStarted" && eventType !== "MemberRunCompleted") {
    processMemberEvent(eventType, d, state);
    if (eventType !== "ToolApprovalRequired" && eventType !== "ToolApprovalResolved") {
      scheduleUpdate(state, callbacks.onUpdate);
      return;
    }
  }

  switch (eventType) {
    case "RunStarted":
      callbacks.onSessionId?.(d.sessionId as string);
      break;

    case "AssistantMessageId":
      if (Array.isArray(d.blocks)) {
        state.contentBlocks.splice(0, state.contentBlocks.length, ...(d.blocks as ContentBlock[]));
        state.currentTextBlock = "";
        state.currentReasoningBlock = "";
        state.textBlockBoundary = false;
      }
      callbacks.onMessageId?.(d.content as string);
      break;

    case "RunContent":
      handleRunContent(state, (d.content as string) || "", callbacks);
      break;

    case "SeedBlocks":
      if (Array.isArray(d.blocks)) {
        state.contentBlocks.splice(0, state.contentBlocks.length, ...(d.blocks as ContentBlock[]));
        state.currentTextBlock = "";
        state.currentReasoningBlock = "";
        state.textBlockBoundary = false;
      }
      break;

    case "ReasoningStarted":
      flushTextBlock(state);
      break;

    case "ReasoningStep":
      if (state.currentTextBlock && !state.currentReasoningBlock) {
        flushTextBlock(state);
      }
      state.currentReasoningBlock += (d.reasoningContent as string) || "";
      break;

    case "ReasoningCompleted":
      flushReasoningBlock(state);
      break;

    case "ToolCallStarted":
      handleToolCallStarted(state, d.tool);
      break;

    case "ToolApprovalRequired":
      handleToolApprovalRequired(state, d.tool);
      break;

    case "ToolCallCompleted":
      handleToolCallCompleted(state, d.tool);
      break;

    case "ToolApprovalResolved":
      handleToolApprovalResolved(state, d.tool);
      if (d.memberRunId) {
        const toolId = (d.tool as ToolData | undefined)?.id;
        if (toolId) {
          const idx = state.contentBlocks.findIndex(
            (b) => b.type === "tool_call" && b.id === toolId,
          );
          if (idx !== -1) {
            state.contentBlocks.splice(idx, 1);
          }
        }
      }
      break;

    case "FlowNodeStarted":
      flushTextBlock(state);
      flushReasoningBlock(state);
      state.textBlockBoundary = true;
      break;

    case "MemberRunStarted":
      handleMemberRunStarted(state, d);
      break;

    case "MemberRunCompleted":
      handleMemberRunCompleted(state, d);
      break;

    case "MemberRunError": {
      const runId = (d.memberRunId as string) || "";
      if (runId) {
        const block = findMemberBlock(state, runId);
        if (block) {
          const ms = getMemberState(state, runId);
          flushMemberText(block, ms);
          flushMemberReasoning(block, ms);
          block.content.push({
            type: "error",
            content: (d.content as string) || "Agent encountered an error.",
          });
          block.isCompleted = true;
          block.hasError = true;
          state.memberStates.delete(runId);
        }
      }
      break;
    }

    case "RunCompleted":
    case "RunCancelled":
      flushTextBlock(state);
      flushReasoningBlock(state);
      break;

    case "RunError":
      flushTextBlock(state);
      flushReasoningBlock(state);
      state.contentBlocks.push({
        type: "error",
        content: (typeof d.error === "string" ? d.error : typeof d.content === "string" ? d.content : "An error occurred.")
      });
      break;
  }

  scheduleUpdate(state, callbacks.onUpdate);
}

export interface StreamResult {
  finalContent: ContentBlock[];
  messageId: string | null;
}

export async function processMessageStream(
  response: Response,
  callbacks: StreamCallbacks,
  initialBlocks?: ContentBlock[],
): Promise<StreamResult> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  const state = createInitialState();
  if (initialBlocks?.length) {
    state.contentBlocks.push(...initialBlocks);
  }

  let buffer = "";
  let currentEvent = "";
  let messageId: string | null = null;

  const wrappedCallbacks: StreamCallbacks = {
    ...callbacks,
    onMessageId: (id) => {
      messageId = id;
      callbacks.onMessageId?.(id);
    },
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;

        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            processEvent(currentEvent, JSON.parse(data), state, wrappedCallbacks);
          } catch (err) {
            console.error("Failed to parse SSE data:", err);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { finalContent: buildCurrentContent(state), messageId };
}
