"use client";

import type { ContentBlock } from "@/lib/types/chat";
import type { StreamState } from "@/lib/services/stream-processor-state";
import { flushReasoningBlock, flushTextBlock } from "@/lib/services/stream-processor-state";
import { coerceToolApprovalPayload, coerceToolCallPayload } from "@/lib/services/stream-processor-utils";

export function handleToolCallStarted(state: StreamState, tool: unknown): void {
  flushTextBlock(state);
  flushReasoningBlock(state);

  const payload = coerceToolCallPayload(tool, "ToolCallStarted");
  if (!payload) return;

  const existingBlock = state.contentBlocks.find(
    (block) => block.type === "tool_call" && block.id === payload.id,
  );

  if (existingBlock && existingBlock.type === "tool_call") {
    existingBlock.isCompleted = false;
    return;
  }

  state.contentBlocks.push({
    type: "tool_call",
    id: payload.id,
    toolName: payload.toolName,
    toolArgs: payload.toolArgs,
    isCompleted: false,
  });
}

export function handleToolApprovalRequired(state: StreamState, toolData: unknown): void {
  flushTextBlock(state);
  flushReasoningBlock(state);

  const payload = coerceToolApprovalPayload(toolData, "ToolApprovalRequired");
  if (!payload) return;

  for (const tool of payload.tools) {
    const block: ContentBlock = {
      type: "tool_call",
      id: tool.id,
      toolName: tool.toolName,
      toolArgs: tool.toolArgs,
      isCompleted: false,
      requiresApproval: true,
      runId: payload.runId,
      toolCallId: tool.id,
      approvalStatus: "pending",
      editableArgs: tool.editableArgs,
    };
    state.contentBlocks.push(block);
  }
}

export function handleToolCallCompleted(state: StreamState, tool: unknown): void {
  const payload = coerceToolCallPayload(tool, "ToolCallCompleted");
  if (!payload) return;

  const toolBlock = state.contentBlocks.find(
    (block) => block.type === "tool_call" && block.id === payload.id,
  );
  if (!toolBlock || toolBlock.type !== "tool_call") return;

  toolBlock.toolResult = payload.toolResult;
  toolBlock.isCompleted = true;
  if (toolBlock.requiresApproval && toolBlock.approvalStatus === "pending") {
    toolBlock.approvalStatus = "approved";
  }
  if (payload.renderPlan) {
    toolBlock.renderPlan = payload.renderPlan;
  }
}

export function handleToolApprovalResolved(state: StreamState, tool: unknown): void {
  const payload = coerceToolCallPayload(tool, "ToolApprovalResolved");
  if (!payload) return;

  const toolBlock = state.contentBlocks.find(
    (block) => block.type === "tool_call" && block.id === payload.id,
  );
  if (!toolBlock || toolBlock.type !== "tool_call") return;

  toolBlock.approvalStatus = payload.approvalStatus as
    | "pending"
    | "approved"
    | "denied"
    | "timeout"
    | undefined;

  if (payload.toolArgs) {
    toolBlock.toolArgs = payload.toolArgs;
  }
  if (payload.approvalStatus === "denied" || payload.approvalStatus === "timeout") {
    toolBlock.isCompleted = true;
  }
}

export function removeTopLevelToolBlock(state: StreamState, tool: unknown): void {
  const toolId = coerceToolCallPayload(tool, "Member.ToolApprovalResolvedCleanup")?.id;
  if (!toolId) return;

  const index = state.contentBlocks.findIndex(
    (block) => block.type === "tool_call" && block.id === toolId,
  );
  if (index !== -1) {
    state.contentBlocks.splice(index, 1);
  }
}
