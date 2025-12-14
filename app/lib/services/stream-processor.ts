"use client";

export interface StreamCallbacks {
  onUpdate: (content: any[]) => void;
  onSessionId?: (sessionId: string) => void;
  onMessageId?: (messageId: string) => void;
  onThinkTagDetected?: () => void;
}

interface StreamState {
  contentBlocks: any[];
  currentTextBlock: string;
  currentReasoningBlock: string;
  thinkTagDetected: boolean;
}

function createInitialState(): StreamState {
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

function buildCurrentContent(state: StreamState): any[] {
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

function scheduleUpdate(state: StreamState, onUpdate: (content: any[]) => void): void {
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

function handleToolCallStarted(state: StreamState, tool: any): void {
  flushTextBlock(state);
  flushReasoningBlock(state);

  if (tool) {
    state.contentBlocks.push({
      type: "tool_call",
      id: tool.id,
      toolName: tool.toolName,
      toolArgs: tool.toolArgs,
      isCompleted: false,
    });
  }
}

function handleToolApprovalRequired(state: StreamState, tool: any): void {
  flushTextBlock(state);
  flushReasoningBlock(state);

  const approvalId = tool.approvalId;
  const messageIdPrefix = approvalId.split("-approval-")[0];

  const existingBlock = [...state.contentBlocks]
    .reverse()
    .find((b) => b.type === "tool_call" && b.id?.startsWith(messageIdPrefix));

  if (existingBlock) {
    existingBlock.requiresApproval = true;
    existingBlock.approvalId = approvalId;
    existingBlock.approvalStatus = "pending";
  } else {
    state.contentBlocks.push({
      type: "tool_call",
      id: approvalId,
      toolName: tool.toolName,
      toolArgs: tool.toolArgs,
      isCompleted: false,
      requiresApproval: true,
      approvalId: approvalId,
      approvalStatus: "pending",
    });
  }
}

function handleToolCallCompleted(state: StreamState, tool: any): void {
  let toolBlock = [...state.contentBlocks]
    .reverse()
    .find((b) => b.type === "tool_call" && b.id === tool.id);

  if (!toolBlock) {
    toolBlock = [...state.contentBlocks]
      .reverse()
      .find(
        (b) =>
          b.type === "tool_call" &&
          b.requiresApproval &&
          b.toolName === tool.toolName &&
          JSON.stringify(b.toolArgs) === JSON.stringify(tool.toolArgs),
      );
  }

  if (toolBlock) {
    toolBlock.toolResult = tool.toolResult;
    toolBlock.isCompleted = true;
    if (toolBlock.requiresApproval && toolBlock.approvalStatus === "pending") {
      toolBlock.approvalStatus = "approved";
    }
    if (tool.renderer) {
      toolBlock.renderer = tool.renderer;
    }
  }
}

function processEvent(
  eventType: string,
  data: any,
  state: StreamState,
  callbacks: StreamCallbacks,
): void {
  switch (eventType) {
    case "RunStarted":
      if (data.sessionId) callbacks.onSessionId?.(data.sessionId);
      break;

    case "AssistantMessageId":
      if (data.content) callbacks.onMessageId?.(data.content);
      break;

    case "RunContent":
      if (data.content) handleRunContent(state, data.content, callbacks);
      break;

    case "SeedBlocks":
      if (Array.isArray(data.blocks)) {
        state.contentBlocks.splice(0, state.contentBlocks.length, ...data.blocks);
        state.currentTextBlock = "";
        state.currentReasoningBlock = "";
      }
      break;

    case "ReasoningStarted":
      flushTextBlock(state);
      break;

    case "ReasoningStep":
      if (data.reasoningContent) {
        if (state.currentTextBlock && !state.currentReasoningBlock) {
          flushTextBlock(state);
        }
        state.currentReasoningBlock += data.reasoningContent;
      }
      break;

    case "ReasoningCompleted":
      flushReasoningBlock(state);
      break;

    case "ToolCallStarted":
      handleToolCallStarted(state, data.tool);
      break;

    case "ToolApprovalRequired":
      if (data.tool) handleToolApprovalRequired(state, data.tool);
      break;

    case "ToolCallCompleted":
      if (data.tool) handleToolCallCompleted(state, data.tool);
      break;

    case "RunCompleted":
      flushTextBlock(state);
      flushReasoningBlock(state);
      break;

    case "RunError":
      flushTextBlock(state);
      flushReasoningBlock(state);
      const errText =
        typeof data.error === "string"
          ? data.error
          : typeof data.content === "string"
            ? data.content
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
