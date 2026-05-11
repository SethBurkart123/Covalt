import type { ApprovalOption, ApprovalRequest } from "@/lib/renderers";
import type { ToolCallPayload } from "@/lib/types/chat";

const DEFAULT_OPTIONS: ApprovalOption[] = [
  { value: "allow_once", label: "Approve", role: "allow_once", style: "primary" },
  { value: "deny", label: "Deny", role: "deny", style: "destructive" },
];

export function buildLegacyApprovalRequest(
  toolCall: ToolCallPayload,
  runId: string,
): ApprovalRequest {
  return {
    toolCallId: toolCall.toolCallId ?? toolCall.id,
    runId,
    kind: toolCall.approvalKind ?? "tool_approval",
    toolUseIds: toolCall.toolCallId ? [toolCall.toolCallId] : [],
    toolName: toolCall.toolName,
    riskLevel: toolCall.riskLevel,
    summary: toolCall.summary,
    options: toolCall.options ?? DEFAULT_OPTIONS,
    questions: toolCall.questions ?? [],
    editable: toolCall.editable ?? [],
    renderer: toolCall.renderPlan?.renderer,
    config: { toolArgs: toolCall.toolArgs },
  };
}
