"use client";

import type { StreamState } from "@/lib/services/stream-processor-state";
import { flushReasoningBlock, flushTextBlock } from "@/lib/services/stream-processor-state";

export function handleFlowNodeStarted(state: StreamState): void {
  flushTextBlock(state);
  flushReasoningBlock(state);
  state.textBlockBoundary = true;
}
