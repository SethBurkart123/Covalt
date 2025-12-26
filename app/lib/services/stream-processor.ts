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

export interface StreamCallbacks {
  onUpdate: (content: ContentBlock[]) => void;
  onSessionId?: (sessionId: string) => void;
  onMessageId?: (messageId: string) => void;
  onThinkTagDetected?: () => void;
}

export interface StreamState {
  contentBlocks: ContentBlock[];
  currentTextBlock: string;
  currentReasoningBlock: string;
  thinkTagDetected: boolean;
}

export function createInitialState(): StreamState {
  return {
    contentBlocks: [],
    currentTextBlock: "",
    currentReasoningBlock: "",
    thinkTagDetected: false,
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

function buildCurrentContent(state: StreamState): ContentBlock[] {
  const content = [...state.contentBlocks];

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

  // Resume from last text block if needed
  if (state.currentTextBlock === "" && state.contentBlocks.length > 0) {
    const last = state.contentBlocks[state.contentBlocks.length - 1];
    if (last?.type === "text") {
      state.contentBlocks.pop();
      state.currentTextBlock = last.content || "";
    }
  }

  state.currentTextBlock += content;

  // Detect thinking tags
  if (!state.thinkTagDetected && state.currentTextBlock.includes("<think>")) {
    state.thinkTagDetected = true;
    callbacks.onThinkTagDetected?.();
  }
}

function handleToolCallStarted(state: StreamState, tool: unknown): void {
  flushTextBlock(state);
  flushReasoningBlock(state);

  if (tool) {
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

  if (toolBlock && toolBlock.type === "tool_call") {
    toolBlock.toolResult = t.toolResult;
    toolBlock.isCompleted = true;
    if (toolBlock.requiresApproval && toolBlock.approvalStatus === "pending") {
      toolBlock.approvalStatus = "approved";
    }
    if (t.renderer) {
      toolBlock.renderer = t.renderer;
    }
  }
}

function handleToolApprovalResolved(state: StreamState, tool: unknown): void {
  const t = tool as ToolData;
  const toolBlock = state.contentBlocks.find(
    (b) => b.type === "tool_call" && b.id === t.id,
  );
  
  if (toolBlock && toolBlock.type === "tool_call") {
    toolBlock.approvalStatus = t.approvalStatus as "pending" | "approved" | "denied" | "timeout" | undefined;
    if (t.toolArgs) {
      toolBlock.toolArgs = t.toolArgs;
    }
    if (t.approvalStatus === "denied" || t.approvalStatus === "timeout") {
      toolBlock.isCompleted = true;
    }
  }
}

export function processEvent(
  eventType: string,
  data: unknown,
  state: StreamState,
  callbacks: StreamCallbacks,
): void {
  const d = data as Record<string, unknown>;
  
  switch (eventType) {
    case "RunStarted":
      if (d.sessionId) callbacks.onSessionId?.(d.sessionId as string);
      break;

    case "AssistantMessageId":
      if (d.content) callbacks.onMessageId?.(d.content as string);
      break;

    case "RunContent":
      if (d.content) handleRunContent(state, d.content as string, callbacks);
      break;

    case "SeedBlocks":
      if (Array.isArray(d.blocks)) {
        state.contentBlocks.splice(0, state.contentBlocks.length, ...(d.blocks as ContentBlock[]));
        state.currentTextBlock = "";
        state.currentReasoningBlock = "";
      }
      break;

    case "ReasoningStarted":
      flushTextBlock(state);
      break;

    case "ReasoningStep":
      if (d.reasoningContent) {
        if (state.currentTextBlock && !state.currentReasoningBlock) {
          flushTextBlock(state);
        }
        state.currentReasoningBlock += d.reasoningContent as string;
      }
      break;

    case "ReasoningCompleted":
      flushReasoningBlock(state);
      break;

    case "ToolCallStarted":
      handleToolCallStarted(state, d.tool);
      break;

    case "ToolApprovalRequired":
      if (d.tool) handleToolApprovalRequired(state, d.tool);
      break;

    case "ToolCallCompleted":
      if (d.tool) handleToolCallCompleted(state, d.tool);
      break;

    case "ToolApprovalResolved":
      if (d.tool) handleToolApprovalResolved(state, d.tool);
      break;

    case "RunCompleted":
      flushTextBlock(state);
      flushReasoningBlock(state);
      break;

    case "RunError":
      flushTextBlock(state);
      flushReasoningBlock(state);
      const errText =
        typeof d.error === "string"
          ? d.error
          : typeof d.content === "string"
            ? d.content
            : "An error occurred.";
      state.contentBlocks.push({ type: "error", content: errText });
      break;
  }

  scheduleUpdate(state, callbacks.onUpdate);
}

export async function processMessageStream(
  response: Response,
  callbacks: StreamCallbacks,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  const state = createInitialState();

  let buffer = "";
  let currentEvent = "";

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
            const parsed = JSON.parse(data);
            processEvent(currentEvent, parsed, state, callbacks);
          } catch (err) {
            console.error("Failed to parse SSE data:", err);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

