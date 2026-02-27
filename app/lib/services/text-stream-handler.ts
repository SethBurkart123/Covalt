"use client";

import type { ContentBlock } from "@/lib/types/chat";
import type { StreamCallbacks, StreamState } from "@/lib/services/stream-processor-state";
import {
  flushReasoningBlock,
  flushTextBlock,
  replaceBlocks,
} from "@/lib/services/stream-processor-state";

export function handleRunContent(
  state: StreamState,
  content: string,
  callbacks: StreamCallbacks,
): void {
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

  if (
    !state.thinkTagDetected
    && state.currentTextBlock.toLowerCase().includes("<think>")
  ) {
    state.thinkTagDetected = true;
    callbacks.onThinkTagDetected?.();
  }
}

export function handleAssistantMessageId(
  state: StreamState,
  payload: Record<string, unknown>,
  callbacks: StreamCallbacks,
): void {
  if (Array.isArray(payload.blocks)) {
    replaceBlocks(state, payload.blocks as ContentBlock[]);
  }
  callbacks.onMessageId?.(payload.content as string);
}

export function handleSeedBlocks(
  state: StreamState,
  payload: Record<string, unknown>,
): void {
  if (!Array.isArray(payload.blocks)) return;
  replaceBlocks(state, payload.blocks as ContentBlock[]);
}

export function handleReasoningStarted(state: StreamState): void {
  flushTextBlock(state);
}

export function handleReasoningStep(
  state: StreamState,
  payload: Record<string, unknown>,
): void {
  if (state.currentTextBlock && !state.currentReasoningBlock) {
    flushTextBlock(state);
  }
  state.currentReasoningBlock += (payload.reasoningContent as string) || "";
}

export function handleReasoningCompleted(state: StreamState): void {
  flushReasoningBlock(state);
}

export function handleTerminalRunEvent(state: StreamState): void {
  flushTextBlock(state);
  flushReasoningBlock(state);
}

export function handleRunError(
  state: StreamState,
  payload: Record<string, unknown>,
): void {
  flushTextBlock(state);
  flushReasoningBlock(state);

  state.contentBlocks.push({
    type: "error",
    content:
      typeof payload.error === "string"
        ? payload.error
        : typeof payload.content === "string"
          ? payload.content
          : "An error occurred.",
  });
}
