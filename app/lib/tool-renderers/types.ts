import type { RenderPlan, ToolCallPayload } from "@/lib/types/chat";
import type { CollapsibleMode } from "@/components/ui/collapsible";

export interface ToolCallRendererProps extends ToolCallPayload {
  isCompleted: boolean;
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
