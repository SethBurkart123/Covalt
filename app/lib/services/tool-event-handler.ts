
import type {
  ApprovalRequiredPayload,
  ContentBlock,
  ProgressEntry,
  ToolApprovalTool,
} from "@/lib/types/chat";
import type { StreamState } from "@/lib/services/stream-processor-state";
import { flushReasoningBlock, flushTextBlock } from "@/lib/services/stream-processor-state";
import {
  coerceApprovalRequiredPayload,
  coerceApprovalResolvedPayload,
  coerceToolCallPayload,
} from "@/lib/services/stream-processor-utils";

const PROGRESS_HISTORY_CAP = 200;

export function handleToolCallProgress(state: StreamState, payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const data = payload as Record<string, unknown>;
  const toolId = typeof data.toolCallId === "string" ? data.toolCallId : "";
  if (!toolId) return;

  const findToolBlock = (blocks: ContentBlock[]): ContentBlock | null => {
    for (const block of blocks) {
      if (block.type === "tool_call" && block.id === toolId) return block;
      if (block.type === "member_run") {
        const inner = findToolBlock(block.content);
        if (inner) return inner;
      }
    }
    return null;
  };

  const toolBlock = findToolBlock(state.contentBlocks);
  if (!toolBlock || toolBlock.type !== "tool_call") return;

  const entry: ProgressEntry = {
    kind: typeof data.kind === "string" ? data.kind : "other",
    detail: typeof data.detail === "string" ? data.detail : "",
    progress: typeof data.progress === "number" ? data.progress : null,
    timestamp: typeof data.timestamp === "number" ? data.timestamp : Date.now() / 1000,
  };
  if (typeof data.status === "string") entry.status = data.status;

  const list = toolBlock.progress ?? [];
  list.push(entry);
  if (list.length > PROGRESS_HISTORY_CAP) {
    list.splice(0, list.length - PROGRESS_HISTORY_CAP);
  }
  toolBlock.progress = list;
}

export function upsertToolBlock(
  blocks: ContentBlock[],
  patch: Partial<Extract<ContentBlock, { type: "tool_call" }>> & { id: string },
): Extract<ContentBlock, { type: "tool_call" }> {
  const existing = blocks.find(
    (b): b is Extract<ContentBlock, { type: "tool_call" }> =>
      b.type === "tool_call" && b.id === patch.id,
  );
  if (existing) {
    Object.assign(existing, patch);
    return existing;
  }
  const block: Extract<ContentBlock, { type: "tool_call" }> = {
    type: "tool_call",
    toolName: "",
    toolArgs: {},
    isCompleted: false,
    ...patch,
  };
  blocks.push(block);
  return block;
}

export function approvalToolPatch(
  payload: ApprovalRequiredPayload,
  tool: ToolApprovalTool,
): Partial<Extract<ContentBlock, { type: "tool_call" }>> & { id: string } {
  return {
    id: tool.id,
    toolName: tool.toolName,
    toolArgs: tool.toolArgs,
    isCompleted: false,
    requiresApproval: true,
    runId: payload.runId,
    toolCallId: tool.id,
    approvalKind: payload.kind,
    approvalStatus: "pending",
    editableArgs: tool.editableArgs,
    riskLevel: payload.riskLevel,
    summary: payload.summary,
    options: payload.options,
    questions: payload.questions,
    editable: payload.editable,
  };
}

export function handleToolCallStarted(state: StreamState, tool: unknown): void {
  flushTextBlock(state);
  flushReasoningBlock(state);

  const payload = coerceToolCallPayload(tool, "ToolCallStarted");
  if (!payload) return;

  upsertToolBlock(state.contentBlocks, {
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
    upsertToolBlock(state.contentBlocks, approvalToolPatch(payload, tool));
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
