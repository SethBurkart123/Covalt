import type { ContentBlock } from "@/lib/types/chat";
import { RUNTIME_EVENT } from "@/lib/services/runtime-events";

export type RunPhase =
  | "idle"
  | "starting"
  | "streaming"
  | "paused_hitl"
  | "completed"
  | "error"
  | "cancelled";

export interface RunState {
  phase: RunPhase;
  chatId: string;
  messageId: string | null;
  content: ContentBlock[];
  errorMessage: string | null;
  hasUnseenUpdate: boolean;
}

export type RunEvent =
  | { type: "START"; chatId: string }
  | { type: "SESSION_ID"; chatId: string }
  | { type: "MESSAGE_ID"; messageId: string }
  | { type: "CONTENT_UPDATE"; content: ContentBlock[] }
  | { type: "PAUSED_HITL" }
  | { type: "RESUME_HITL" }
  | { type: "COMPLETED" }
  | { type: "ERROR"; message: string }
  | { type: "CANCELLED" }
  | { type: "STREAM_NOT_ACTIVE" }
  | { type: "MARK_SEEN" };

const ACTIVE_PHASES = new Set<RunPhase>(["starting", "streaming", "paused_hitl"]);
const TERMINAL_PHASES = new Set<RunPhase>(["completed", "error", "cancelled", "idle"]);

export function isActivePhase(phase: RunPhase): boolean {
  return ACTIVE_PHASES.has(phase);
}

export function isTerminalPhase(phase: RunPhase): boolean {
  return TERMINAL_PHASES.has(phase);
}

export function createIdleState(chatId: string): RunState {
  return {
    phase: "idle",
    chatId,
    messageId: null,
    content: [],
    errorMessage: null,
    hasUnseenUpdate: false,
  };
}

export function transition(state: RunState, event: RunEvent): RunState {
  switch (event.type) {
    case "START":
      return {
        ...state,
        phase: "starting",
        chatId: event.chatId,
        messageId: null,
        content: [{ type: "text", content: "" }],
        errorMessage: null,
        hasUnseenUpdate: false,
      };

    case "SESSION_ID":
      if (state.phase === "idle") return state;
      return { ...state, chatId: event.chatId };

    case "MESSAGE_ID":
      if (state.phase === "idle") return state;
      return {
        ...state,
        phase: "streaming",
        messageId: event.messageId,
      };

    case "CONTENT_UPDATE":
      if (!isActivePhase(state.phase)) return state;
      return { ...state, content: event.content };

    case "PAUSED_HITL":
      if (state.phase !== "streaming" && state.phase !== "starting") return state;
      return { ...state, phase: "paused_hitl" };

    case "RESUME_HITL":
      if (state.phase !== "paused_hitl") return state;
      return { ...state, phase: "streaming" };

    case "COMPLETED":
      if (!isActivePhase(state.phase)) return state;
      return { ...state, phase: "completed", hasUnseenUpdate: true };

    case "ERROR":
      if (!isActivePhase(state.phase)) return state;
      return {
        ...state,
        phase: "error",
        errorMessage: event.message,
        hasUnseenUpdate: true,
      };

    case "CANCELLED":
      if (!isActivePhase(state.phase)) return state;
      return { ...state, phase: "cancelled", hasUnseenUpdate: true };

    case "STREAM_NOT_ACTIVE":
      // Don't reset to idle if we're in "starting" -- the sender's direct SSE
      // will provide events even though the broadcaster subscription failed.
      if (state.phase === "starting") return state;
      return { ...state, phase: "idle" };

    case "MARK_SEEN":
      return state.hasUnseenUpdate ? { ...state, hasUnseenUpdate: false } : state;
  }
}

export function runtimeEventToRunEvent(
  eventType: string,
  payload: Record<string, unknown>,
): RunEvent | null {
  switch (eventType) {
    case RUNTIME_EVENT.APPROVAL_REQUIRED:
      return { type: "PAUSED_HITL" };
    case RUNTIME_EVENT.APPROVAL_RESOLVED:
      return { type: "RESUME_HITL" };
    case RUNTIME_EVENT.RUN_COMPLETED:
      return { type: "COMPLETED" };
    case RUNTIME_EVENT.RUN_CANCELLED:
      return { type: "CANCELLED" };
    case RUNTIME_EVENT.RUN_ERROR:
      return {
        type: "ERROR",
        message: (payload.content as string) || "Unknown error",
      };
    default:
      return null;
  }
}
