import type { RenderPlan } from "@/lib/types/chat";
import type { CollapsibleMode } from "@/components/ui/collapsible";

export interface ToolCallRendererProps {
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolResult?: string;
  isCompleted: boolean;
  requiresApproval?: boolean;
  runId?: string;
  toolCallId?: string;
  approvalStatus?: "pending" | "approved" | "denied" | "timeout";
  editableArgs?: string[] | boolean;
  isGrouped?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
  renderPlan?: RenderPlan;
  chatId?: string;
  mode?: CollapsibleMode;
}

export type ToolCallRenderer = React.ComponentType<ToolCallRendererProps>;

export interface RendererDefinition {
  key: string;
  component: ToolCallRenderer;
}
