"use client";

import { FileText } from "lucide-react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleIcon,
  CollapsibleHeader,
} from "@/components/ui/collapsible";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { useArtifactPanel } from "@/contexts/artifact-panel-context";
import type { ToolCallRendererProps } from "@/lib/tool-renderers/types";
import { cn } from "@/lib/utils";

export function MarkdownArtifact({
  toolName,
  toolArgs,
  toolResult,
  isCompleted,
  toolCallId,
  isGrouped = false,
  isFirst = false,
  isLast = false,
}: ToolCallRendererProps) {
  const { open, activeId } = useArtifactPanel();
  const title = (toolArgs.title as string) || toolName;
  const id = toolCallId || `${toolName}-${title}`;
  const isActive = activeId === id;

  const handleClick = () => {
    if (!isCompleted || !toolResult) return;
    open(id, title, <MarkdownRenderer content={toolResult} />);
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
      <CollapsibleTrigger onClick={handleClick} className={cn(isActive && "bg-muted/50", "py-4 !rounded-4xl")}>
        <CollapsibleHeader>
          <CollapsibleIcon icon={FileText} />
          <span className="text-sm font-medium text-foreground">
            {title}
          </span>
          {!isCompleted && (
            <span className="text-xs text-muted-foreground">generating...</span>
          )}
        </CollapsibleHeader>
      </CollapsibleTrigger>
    </Collapsible>
  );
}
