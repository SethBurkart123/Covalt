"use client";

import type { ContentBlock } from "@/lib/types/chat";
import { RUNTIME_EVENT } from "@/lib/services/runtime-events";
import type {
  MemberRunBlock,
  StreamState,
} from "@/lib/services/stream-processor-state";
import {
  findMemberBlock,
  flushMemberReasoning,
  flushMemberText,
  flushReasoningBlock,
  flushTextBlock,
  getMemberState,
} from "@/lib/services/stream-processor-state";
import { coerceToolApprovalPayload, coerceToolCallPayload } from "@/lib/services/stream-processor-utils";

function getOrCreateMemberBlock(
  state: StreamState,
  payload: Record<string, unknown>,
): MemberRunBlock {
  const runId = payload.memberRunId as string;
  const memberName = (payload.memberName as string) || "Agent";

  let block = findMemberBlock(state, runId);
  if (!block) {
    block = {
      type: "member_run",
      runId,
      memberName,
      content: [],
      isCompleted: false,
      task: (payload.task as string) || "",
      nodeId: (payload.nodeId as string) || undefined,
      nodeType: (payload.nodeType as string) || undefined,
      groupByNode: (payload.groupByNode as boolean) || undefined,
    };
    state.contentBlocks.push(block);
  }

  if (memberName && memberName !== "Agent") {
    block.memberName = memberName;
  }
  if (payload.nodeId && !block.nodeId) {
    block.nodeId = payload.nodeId as string;
  }
  if (payload.nodeType && !block.nodeType) {
    block.nodeType = payload.nodeType as string;
  }
  if (payload.groupByNode && !block.groupByNode) {
    block.groupByNode = true;
  }

  return block;
}

export function handleMemberRunStarted(
  state: StreamState,
  payload: Record<string, unknown>,
): void {
  flushTextBlock(state);
  flushReasoningBlock(state);

  const runId = (payload.memberRunId as string) || "";
  const memberName = (payload.memberName as string) || "Agent";
  const task = (payload.task as string) || "";

  if (runId && findMemberBlock(state, runId)) return;

  state.contentBlocks.push({
    type: "member_run",
    runId,
    memberName,
    content: [],
    isCompleted: false,
    task,
    nodeId: (payload.nodeId as string) || undefined,
    nodeType: (payload.nodeType as string) || undefined,
    groupByNode: (payload.groupByNode as boolean) || undefined,
  });
  getMemberState(state, runId);
}

export function handleMemberRunCompleted(
  state: StreamState,
  payload: Record<string, unknown>,
): void {
  const runId = (payload.memberRunId as string) || "";

  if (runId) {
    const block = findMemberBlock(state, runId);
    if (!block) return;

    const memberState = getMemberState(state, runId);
    flushMemberText(block, memberState);
    flushMemberReasoning(block, memberState);
    block.isCompleted = true;
    state.memberStates.delete(runId);
    return;
  }

  for (const block of state.contentBlocks) {
    if (block.type !== "member_run" || block.isCompleted) continue;

    const memberState = state.memberStates.get(block.runId);
    if (memberState) {
      flushMemberText(block, memberState);
      flushMemberReasoning(block, memberState);
      state.memberStates.delete(block.runId);
    }
    block.isCompleted = true;
  }
}

export function processMemberEvent(
  eventType: string,
  payload: Record<string, unknown>,
  state: StreamState,
): void {
  const runId = payload.memberRunId as string;
  const block = getOrCreateMemberBlock(state, payload);
  const memberState = getMemberState(state, runId);

  switch (eventType) {
    case RUNTIME_EVENT.RUN_CONTENT: {
      const text = (payload.content as string) || "";
      if (memberState.currentReasoningBlock && !memberState.currentTextBlock) {
        flushMemberReasoning(block, memberState);
      }
      memberState.currentTextBlock += text;
      break;
    }

    case RUNTIME_EVENT.REASONING_STARTED:
      flushMemberText(block, memberState);
      break;

    case RUNTIME_EVENT.REASONING_STEP: {
      const text = (payload.reasoningContent as string) || "";
      if (!text) break;

      if (memberState.currentTextBlock && !memberState.currentReasoningBlock) {
        flushMemberText(block, memberState);
      }
      memberState.currentReasoningBlock += text;
      break;
    }

    case RUNTIME_EVENT.REASONING_COMPLETED:
      flushMemberReasoning(block, memberState);
      break;

    case RUNTIME_EVENT.TOOL_CALL_STARTED: {
      flushMemberText(block, memberState);
      flushMemberReasoning(block, memberState);
      const tool = coerceToolCallPayload(payload.tool, "Member.ToolCallStarted");
      if (!tool) break;

      const existing = block.content.find(
        (item): item is Extract<ContentBlock, { type: "tool_call" }> =>
          item.type === "tool_call" && item.id === tool.id,
      );

      if (existing) {
        existing.toolName = tool.toolName || existing.toolName;
        existing.toolArgs = tool.toolArgs || existing.toolArgs;
        existing.isCompleted = false;
      } else {
        block.content.push({
          type: "tool_call",
          id: tool.id,
          toolName: tool.toolName,
          toolArgs: tool.toolArgs,
          isCompleted: false,
        });
      }
      break;
    }

    case RUNTIME_EVENT.TOOL_CALL_COMPLETED: {
      const tool = coerceToolCallPayload(payload.tool, "Member.ToolCallCompleted");
      if (!tool) break;

      const toolCall = block.content.find(
        (item): item is Extract<ContentBlock, { type: "tool_call" }> =>
          item.type === "tool_call" && item.id === tool.id,
      );
      if (!toolCall) break;

      toolCall.isCompleted = true;
      toolCall.toolResult = tool.toolResult;
      if (tool.renderPlan) {
        toolCall.renderPlan = tool.renderPlan;
      }
      break;
    }

    case RUNTIME_EVENT.TOOL_APPROVAL_REQUIRED: {
      flushMemberText(block, memberState);
      flushMemberReasoning(block, memberState);
      const approvalPayload = coerceToolApprovalPayload(
        payload.tool,
        "Member.ToolApprovalRequired",
      );
      if (!approvalPayload) break;

      for (const tool of approvalPayload.tools) {
        block.content.push({
          type: "tool_call",
          id: tool.id,
          toolName: tool.toolName,
          toolArgs: tool.toolArgs,
          isCompleted: false,
          requiresApproval: true,
          runId: approvalPayload.runId,
          toolCallId: tool.id,
          approvalStatus: "pending",
          editableArgs: tool.editableArgs,
        });
      }
      break;
    }

    case RUNTIME_EVENT.TOOL_APPROVAL_RESOLVED: {
      const tool = coerceToolCallPayload(payload.tool, "Member.ToolApprovalResolved");
      if (!tool) break;

      const toolCall = block.content.find(
        (item): item is Extract<ContentBlock, { type: "tool_call" }> =>
          item.type === "tool_call" && item.id === tool.id,
      );
      if (!toolCall) break;

      toolCall.approvalStatus = tool.approvalStatus as
        | "pending"
        | "approved"
        | "denied"
        | "timeout"
        | undefined;

      if (tool.toolArgs) {
        toolCall.toolArgs = tool.toolArgs;
      }
      if (tool.approvalStatus === "denied" || tool.approvalStatus === "timeout") {
        toolCall.isCompleted = true;
      }
      break;
    }

    case RUNTIME_EVENT.RUN_ERROR:
    case RUNTIME_EVENT.MEMBER_RUN_ERROR: {
      flushMemberText(block, memberState);
      flushMemberReasoning(block, memberState);
      const errorContent =
        (payload.content as string)
        || (payload.error as string)
        || "Agent encountered an error.";
      block.content.push({ type: "error", content: errorContent });
      block.isCompleted = true;
      block.hasError = true;
      state.memberStates.delete(runId);
      break;
    }
  }
}
