"use client";

import type { ContentBlock } from "@/lib/types/chat";
import { RUNTIME_EVENT, isKnownRuntimeEvent } from "@/lib/services/runtime-events";
import { handleFlowNodeStarted } from "@/lib/services/flow-node-handler";
import {
  handleMemberRunCompleted,
  handleMemberRunStarted,
  processMemberEvent,
} from "@/lib/services/member-run-handler";
import {
  buildCurrentContent,
  createInitialState,
  normalizeEventPayload,
  scheduleUpdate,
  type StreamCallbacks,
  type StreamState,
} from "@/lib/services/stream-processor-state";
import { warnUnknownRuntimeEvent } from "@/lib/services/stream-processor-utils";
import {
  handleAssistantMessageId,
  handleReasoningCompleted,
  handleReasoningStarted,
  handleReasoningStep,
  handleRunContent,
  handleRunError,
  handleSeedBlocks,
  handleTerminalRunEvent,
} from "@/lib/services/text-stream-handler";
import {
  handleToolApprovalRequired,
  handleToolApprovalResolved,
  handleToolCallCompleted,
  handleToolCallStarted,
  removeTopLevelToolBlock,
} from "@/lib/services/tool-event-handler";

export { createInitialState };
export type { StreamCallbacks, StreamState };

function emitEvent(
  callbacks: StreamCallbacks,
  eventType: string,
  payload: Record<string, unknown>,
): void {
  callbacks.onEvent?.(eventType, payload);
}

export function processEvent(
  eventType: string,
  data: unknown,
  state: StreamState,
  callbacks: StreamCallbacks,
): void {
  const payload = normalizeEventPayload(data);

  if (typeof payload.sessionId === "string" && payload.sessionId) {
    callbacks.onSessionId?.(payload.sessionId);
  }

  if (!isKnownRuntimeEvent(eventType)) {
    warnUnknownRuntimeEvent(eventType, payload);
    emitEvent(callbacks, eventType, payload);
    return;
  }

  emitEvent(callbacks, eventType, payload);

  const isMemberScoped = Boolean(payload.memberRunId)
    && eventType !== RUNTIME_EVENT.MEMBER_RUN_STARTED
    && eventType !== RUNTIME_EVENT.MEMBER_RUN_COMPLETED;

  if (isMemberScoped) {
    processMemberEvent(eventType, payload, state);
    if (
      eventType !== RUNTIME_EVENT.TOOL_APPROVAL_REQUIRED
      && eventType !== RUNTIME_EVENT.TOOL_APPROVAL_RESOLVED
    ) {
      scheduleUpdate(state, callbacks.onUpdate);
      return;
    }
  }

  switch (eventType) {
    case RUNTIME_EVENT.RUN_STARTED:
    case RUNTIME_EVENT.STREAM_NOT_ACTIVE:
    case RUNTIME_EVENT.STREAM_SUBSCRIBED:
    case RUNTIME_EVENT.FLOW_NODE_COMPLETED:
    case RUNTIME_EVENT.FLOW_NODE_RESULT:
    case RUNTIME_EVENT.FLOW_NODE_ERROR:
    case RUNTIME_EVENT.TOOL_CALL_FAILED:
    case RUNTIME_EVENT.TOOL_CALL_ERROR:
      break;

    case RUNTIME_EVENT.ASSISTANT_MESSAGE_ID:
      handleAssistantMessageId(state, payload, callbacks);
      break;

    case RUNTIME_EVENT.RUN_CONTENT:
      handleRunContent(state, (payload.content as string) || "", callbacks);
      break;

    case RUNTIME_EVENT.SEED_BLOCKS:
      handleSeedBlocks(state, payload);
      break;

    case RUNTIME_EVENT.REASONING_STARTED:
      handleReasoningStarted(state);
      break;

    case RUNTIME_EVENT.REASONING_STEP:
      handleReasoningStep(state, payload);
      break;

    case RUNTIME_EVENT.REASONING_COMPLETED:
      handleReasoningCompleted(state);
      break;

    case RUNTIME_EVENT.TOOL_CALL_STARTED:
      handleToolCallStarted(state, payload.tool);
      break;

    case RUNTIME_EVENT.TOOL_APPROVAL_REQUIRED:
      handleToolApprovalRequired(state, payload.tool);
      break;

    case RUNTIME_EVENT.TOOL_CALL_COMPLETED:
      handleToolCallCompleted(state, payload.tool);
      break;

    case RUNTIME_EVENT.TOOL_APPROVAL_RESOLVED:
      handleToolApprovalResolved(state, payload.tool);
      if (payload.memberRunId) {
        removeTopLevelToolBlock(state, payload.tool);
      }
      break;

    case RUNTIME_EVENT.FLOW_NODE_STARTED:
      handleFlowNodeStarted(state);
      break;

    case RUNTIME_EVENT.MEMBER_RUN_STARTED:
      handleMemberRunStarted(state, payload);
      break;

    case RUNTIME_EVENT.MEMBER_RUN_COMPLETED:
      handleMemberRunCompleted(state, payload);
      break;

    case RUNTIME_EVENT.MEMBER_RUN_ERROR: {
      const runId = (payload.memberRunId as string) || "";
      if (runId) {
        processMemberEvent(eventType, payload, state);
      }
      break;
    }

    case RUNTIME_EVENT.RUN_COMPLETED:
    case RUNTIME_EVENT.RUN_CANCELLED:
      handleTerminalRunEvent(state);
      break;

    case RUNTIME_EVENT.RUN_ERROR:
      handleRunError(state, payload);
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
          continue;
        }

        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        if (data === "[DONE]") continue;

        try {
          processEvent(currentEvent, JSON.parse(data), state, wrappedCallbacks);
        } catch (error) {
          console.error("Failed to parse SSE data:", error);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const finalContent = buildCurrentContent(state);
  callbacks.onUpdate(finalContent);

  return { finalContent, messageId };
}
