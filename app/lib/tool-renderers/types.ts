import type { RenderPlan } from "@/lib/types/chat";

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
  renderPlan?: RenderPlan;
  chatId?: string;
}

export type ToolCallRenderer = React.ComponentType<ToolCallRendererProps>;

/**
 * Definition for a tool call renderer.
 * Similar to ProviderDefinition, this provides a declarative way to register renderers.
 */
export interface RendererDefinition {
  /** Unique identifier for the renderer (e.g., "code", "markdown", "html") */
  key: string;
  /** The React component that renders this tool call type */
  component: ToolCallRenderer;
}
