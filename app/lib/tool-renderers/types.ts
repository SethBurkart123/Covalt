export interface ToolCallRendererProps {
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolResult?: string;
  isCompleted: boolean;
  renderer?: string;
  requiresApproval?: boolean;
  runId?: string;
  toolCallId?: string;
  approvalStatus?: "pending" | "approved" | "denied" | "timeout";
  editableArgs?: string[] | boolean;
  isGrouped?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
}

export type ToolCallRenderer = React.ComponentType<ToolCallRendererProps>;
