"use client";

import { getToolCallRenderer } from "@/lib/tool-renderers/registry";
import { DefaultToolCall } from "@/components/tool-renderers/default/DefaultToolCall";
import type { ToolCallRendererProps } from "@/lib/tool-renderers/types";

export function ToolCallRouter(props: ToolCallRendererProps) {
  if (props.requiresApproval && props.approvalStatus === "pending") {
    return <DefaultToolCall {...props} />;
  }

  const Renderer = getToolCallRenderer(props.renderPlan?.renderer);
  return <Renderer {...props} />;
}
