import type { RenderPlan, ToolCallPayload } from "@/lib/types/chat";
import type { CollapsibleMode } from "@/components/ui/collapsible";

export interface ToolCallDisplayConfig {
  title?: string;
  icon?: string;
}

export interface ToolCallRendererProps extends ToolCallPayload {
  isCompleted: boolean;
  isGrouped?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
  renderPlan?: RenderPlan;
  display?: ToolCallDisplayConfig;
  chatId?: string;
  mode?: CollapsibleMode;
}

export type ToolCallRenderer = React.ComponentType<ToolCallRendererProps>;

export interface RendererDefinition {
  key: string;
  aliases: readonly string[];
  load: () => Promise<{ default: ToolCallRenderer }>;
}
