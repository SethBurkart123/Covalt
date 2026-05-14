
import type { ContentBlock } from "@/lib/types/chat";
import {
  RUNTIME_EVENT,
  isKnownRuntimeEvent,
  isTerminalRuntimeEvent,
} from "@/lib/services/runtime-events";
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
  handleApprovalRequired,
  handleApprovalResolved,
  handleToolCallCompleted,
  handleToolCallProgress,
  handleToolCallStarted,
} from "@/lib/services/tool-event-handler";
import type { TokenUsage } from "@/lib/types/chat";
import { OutputSmoothingController } from "@/lib/services/output-smoothing";

export { createInitialState };
export type { StreamState };

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
    scheduleUpdate(state, callbacks.onUpdate);
    return;
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

    case RUNTIME_EVENT.APPROVAL_REQUIRED:
      handleApprovalRequired(state, payload.tool);
      break;

    case RUNTIME_EVENT.TOOL_CALL_COMPLETED:
      handleToolCallCompleted(state, payload.tool);
      break;

    case RUNTIME_EVENT.APPROVAL_RESOLVED:
      handleApprovalResolved(state, payload.tool);
      break;

    case RUNTIME_EVENT.TOOL_CALL_PROGRESS:
      handleToolCallProgress(state, payload.progress);
      break;

    case RUNTIME_EVENT.WORKING_STATE_CHANGED:
      if (typeof payload.state === "string" && payload.state) {
        state.messageState = payload.state;
      }
      break;

    case RUNTIME_EVENT.TOKEN_USAGE:
      if (payload.tokenUsage && typeof payload.tokenUsage === "object") {
        state.messageTokenUsage = payload.tokenUsage as TokenUsage;
      }
      break;

    case RUNTIME_EVENT.STREAM_WARNING:
      if (payload.warning && typeof payload.warning === "object") {
        const warn = payload.warning as Record<string, unknown>;
        const message = typeof warn.message === "string" ? warn.message : "";
        if (message) {
          state.contentBlocks.push({
            type: "system_event",
            level: typeof warn.level === "string" ? warn.level : "warning",
            content: message,
            timestamp: new Date().toISOString(),
          });
        }
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

export interface ProcessMessageStreamOptions {
  smoothOutput?: boolean;
  outputSmoothingDelayMs?: number;
}

export async function processMessageStream(
  response: Response,
  callbacks: StreamCallbacks,
  initialBlocks?: ContentBlock[],
  options?: ProcessMessageStreamOptions,
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
  const outputSmoothing = options?.smoothOutput
    ? new OutputSmoothingController(callbacks.onUpdate, {
        delayMs: options.outputSmoothingDelayMs,
      })
    : null;
  const pendingTerminalEvents: [string, Record<string, unknown>][] = [];

  const wrappedCallbacks: StreamCallbacks = {
    ...callbacks,
    onUpdate: outputSmoothing
      ? (content) => outputSmoothing.update(content)
      : callbacks.onUpdate,
    onMessageId: (id) => {
      messageId = id;
      callbacks.onMessageId?.(id);
    },
    onEvent: outputSmoothing
      ? (eventType, payload) => {
          if (isTerminalRuntimeEvent(eventType)) {
            pendingTerminalEvents.push([eventType, payload]);
            return;
          }
          callbacks.onEvent?.(eventType, payload);
        }
      : callbacks.onEvent,
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
  if (outputSmoothing) {
    await outputSmoothing.finish(finalContent);
    for (const [eventType, payload] of pendingTerminalEvents) {
      callbacks.onEvent?.(eventType, payload);
    }
  } else {
    callbacks.onUpdate(finalContent);
  }

  return { finalContent, messageId };
}
