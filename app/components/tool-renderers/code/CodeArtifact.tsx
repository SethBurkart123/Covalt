"use client";

import { FileCode2, Loader2 } from "lucide-react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleIcon,
  CollapsibleHeader,
} from "@/components/ui/collapsible";
import { useArtifactPanel } from "@/contexts/artifact-panel-context";
import { EditableCodeViewer } from "@/components/EditableCodeViewer";
import type { ToolCallRendererProps } from "@/lib/tool-renderers/types";
import { inferLanguage } from "./utils";

export function CodeArtifact({
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
  const fileState = filePath ? getFileState(filePath) : undefined;

  const title =
    (toolArgs.title as string) ||
    (toolArgs.filename as string) ||
    filePath ||
    toolName;

  const code = filePath && fileState?.content
    ? fileState.content
    : renderPlan?.config?.content
      ? String(renderPlan.config.content)
      : typeof toolResult === "string" && toolResult.length > 0
        ? toolResult
        : (toolArgs.code as string) || "";

  const language = renderPlan?.config?.language === "auto" 
    ? inferLanguage({ ...toolArgs, filename: filePath })
    : (renderPlan?.config?.language || inferLanguage(toolArgs));

  const isEditable = renderPlan?.config?.editable && filePath && chatId;

  const handleClick = () => {
    if (!isCompleted) return;
    
    if (filePath) {
      openFile(filePath);
    }
    
    if (isEditable && filePath) {
      open(
        toolCallId || `${toolName}-${title}`,
        title,
        <EditableCodeViewer language={language} filePath={filePath} />,
        filePath
      );
    } else if (filePath) {
      open(
        toolCallId || `${toolName}-${title}`,
        title,
        <EditableCodeViewer readOnly language={language} filePath={filePath} />,
        filePath
      );
    } else if (code) {
      open(toolCallId || `${toolName}-${title}`, title, <EditableCodeViewer content={code} language={language} />);
    }
  };

  const isLoading = !isCompleted || (filePath && fileState?.isLoading);

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
          <CollapsibleIcon icon={FileCode2} />
          <span className="text-sm font-medium text-foreground">{title}</span>
          {isLoading && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </CollapsibleHeader>
      </CollapsibleTrigger>
    </Collapsible>
  );
}
