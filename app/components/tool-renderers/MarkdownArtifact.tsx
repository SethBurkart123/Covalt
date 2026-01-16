"use client";

import { FileText, Loader2 } from "lucide-react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleIcon,
  CollapsibleHeader,
} from "@/components/ui/collapsible";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { useArtifactPanel } from "@/contexts/artifact-panel-context";
import type { ToolCallRendererProps } from "@/lib/tool-renderers/types";

export function MarkdownArtifact({
  toolName,
  toolArgs,
  toolResult,
  isCompleted,
  toolCallId,
  isGrouped = false,
  isFirst = false,
  isLast = false,
  renderPlan,
  chatId,
}: ToolCallRendererProps) {
  const { open, openFile, getFileState } = useArtifactPanel();

  const filePath = renderPlan?.config?.file;
  const hasFile = !!filePath && !!chatId;

  const fileState = filePath ? getFileState(filePath) : undefined;
  const fileContent = fileState?.content;
  const isLoadingFile = fileState?.isLoading ?? false;

  const title = (toolArgs.title as string) || filePath || toolName;
  const id = toolCallId || `${toolName}-${title}`;

  let content = "";
  if (filePath && fileContent) {
    content = fileContent;
  } else if (renderPlan?.config?.content) {
    content = String(renderPlan.config.content);
  } else if (toolResult) {
    content = toolResult;
  }

  const handleClick = () => {
    if (!isCompleted) return;
    
    if (hasFile && filePath) {
      openFile(filePath);
    }
    
    if (!content && !fileState) return;
    open(id, title,
      <div className="flex-1 overflow-auto p-4 px-8">
        <MarkdownRenderer content={content} />
      </div>,
      filePath);
  };

  const isLoading = !isCompleted || (hasFile && isLoadingFile);

  return (
    <Collapsible
      isGrouped={isGrouped}
      isFirst={isFirst}
      isLast={isLast}
      shimmer={isLoading}
      disableToggle
      data-toolcall
    >
      <CollapsibleTrigger onClick={handleClick}>
        <CollapsibleHeader>
          <CollapsibleIcon icon={FileText} />
          <span className="text-sm font-medium text-foreground">
            {title}
          </span>
          {isLoading && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </CollapsibleHeader>
      </CollapsibleTrigger>
    </Collapsible>
  );
}
