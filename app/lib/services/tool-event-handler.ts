"use client";

import type { ContentBlock } from "@/lib/types/chat";
import type { StreamState } from "@/lib/services/stream-processor-state";
import { flushReasoningBlock, flushTextBlock } from "@/lib/services/stream-processor-state";
import {
  coerceApprovalRequiredPayload,
  coerceApprovalResolvedPayload,
  coerceToolCallPayload,
} from "@/lib/services/stream-processor-utils";

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

export function handleApprovalRequired(state: StreamState, toolData: unknown): void {
  flushTextBlock(state);
  flushReasoningBlock(state);

  const payload = coerceApprovalRequiredPayload(toolData, "ApprovalRequired");
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
      requestId: payload.requestId,
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
  toolBlock.failed = payload.failed;
  if (toolBlock.requiresApproval && toolBlock.approvalStatus === "pending") {
    toolBlock.approvalStatus = "approved";
  }
  if (payload.failed) {
    toolBlock.renderPlan = undefined;
  } else if (payload.renderPlan) {
    toolBlock.renderPlan = payload.renderPlan;
  }
}

export function handleApprovalResolved(state: StreamState, toolData: unknown): void {
  const payload = coerceApprovalResolvedPayload(toolData, "ApprovalResolved");
  if (!payload) return;

  for (const tool of payload.tools) {
    const toolBlock = state.contentBlocks.find(
      (block) => block.type === "tool_call" && block.id === tool.id,
    );
    if (!toolBlock || toolBlock.type !== "tool_call") continue;

    toolBlock.approvalStatus = tool.approvalStatus;

    if (tool.toolArgs) {
      toolBlock.toolArgs = tool.toolArgs;
    }
    if (
      tool.approvalStatus === "approved"
      || tool.approvalStatus === "denied"
      || tool.approvalStatus === "timeout"
    ) {
      toolBlock.isCompleted = true;
    }
  }
}

export function removeTopLevelToolBlock(state: StreamState, tool: unknown): void {
  const toolId = coerceToolCallPayload(tool, "Member.ApprovalResolvedCleanup")?.id;
  if (!toolId) return;

  const index = state.contentBlocks.findIndex(
    (block) => block.type === "tool_call" && block.id === toolId,
  );
  if (index !== -1) {
    state.contentBlocks.splice(index, 1);
  }
}
