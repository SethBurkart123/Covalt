"use client";

import { Code2, Loader2 } from "lucide-react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleIcon,
  CollapsibleHeader,
} from "@/components/ui/collapsible";
import { useArtifactPanel } from "@/contexts/artifact-panel-context";
import type { ToolCallRendererProps } from "@/lib/tool-renderers/types";
import { HtmlArtifactContent } from "./HtmlArtifactContent";

export function HtmlArtifact({
  toolName,
  toolArgs,
  toolResult,
  isCompleted,
  toolCallId,
  isGrouped = false,
  isFirst = false,
  isLast = false,
  renderPlan,
}: ToolCallRendererProps) {
  const { open } = useArtifactPanel();

  const title = (toolArgs.title as string) || toolName;

  const html = typeof renderPlan?.config?.content === "string" && renderPlan.config.content.length > 0
    ? renderPlan.config.content
    : typeof toolResult === "string" && toolResult.length > 0
      ? toolResult
      : (toolArgs.html as string) || "";

  const handleClick = () => {
    if (!isCompleted || !html) return;
    open(
      toolCallId || `${toolName}-${title}`,
      title,
      <HtmlArtifactContent html={html} data={renderPlan?.config?.data} />
    );
  };

  return (
    <Collapsible
      isGrouped={isGrouped}
      isFirst={isFirst}
      isLast={isLast}
      shimmer={!isCompleted}
      disableToggle
      data-toolcall
    >
      <CollapsibleTrigger onClick={handleClick}>
        <CollapsibleHeader>
          <CollapsibleIcon icon={Code2} />
          <span className="text-sm font-medium text-foreground">{title}</span>
          {!isCompleted && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </CollapsibleHeader>
      </CollapsibleTrigger>
    </Collapsible>
  );
}
