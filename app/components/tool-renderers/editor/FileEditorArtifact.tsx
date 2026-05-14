
import { FolderCode, Loader2 } from "lucide-react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleIcon,
  CollapsibleHeader,
} from "@/components/ui/collapsible";
import { useArtifactPanel } from "@/contexts/artifact-panel-context";
import type { ToolCallRendererProps } from "@/lib/tool-renderers/types";
import { FileEditorContent } from "./FileEditorContent";

function toFriendlyToolName(toolName: string): string {
  const raw = toolName.includes(":") ? toolName.split(":").pop() || toolName : toolName;
  const spaced = raw.replace(/[_-]+/g, " ").trim();
  return spaced.replace(/\b\w/g, (char) => char.toUpperCase());
}

function getDisplayTitle(toolArgs: Record<string, unknown>, toolName: string, rootPath: string): string {
  const argTitle = typeof toolArgs.title === "string" ? toolArgs.title.trim() : "";
  if (argTitle) return argTitle;

  if (toolName.endsWith(":display_files") || toolName === "display_files") {
    return rootPath ? `Files in ${rootPath}` : "Files in /";
  }

  return toFriendlyToolName(toolName);
}

export function FileEditorArtifact({
  toolName,
  toolArgs,
  isCompleted,
  toolCallId,
  isGrouped = false,
  isFirst = false,
  isLast = false,
  renderPlan,
  chatId,
}: ToolCallRendererProps) {
  const { toggle } = useArtifactPanel();

  const rootPath = (renderPlan?.config?.path as string) || "";
  const title = getDisplayTitle(toolArgs, toolName, rootPath);
  const editable = renderPlan?.config?.editable !== false;
  const toolCallTestId = `tool-call-${toolName}`;

  const handleClick = () => {
    if (!isCompleted || !chatId) return;
    toggle(
      toolCallId || `${toolName}-${title}`,
      title,
      <FileEditorContent
        chatId={chatId}
        rootPath={rootPath}
        editable={editable}
      />,
    );
  };

  return (
    <Collapsible
      isGrouped={isGrouped}
      isFirst={isFirst}
      isLast={isLast}
      shimmer={!isCompleted}
      disableToggle
      data-testid={toolCallTestId}
      data-toolcall
    >
      <CollapsibleTrigger onClick={handleClick}>
        <CollapsibleHeader>
          <CollapsibleIcon icon={FolderCode} />
          <span className="text-sm font-medium text-foreground">{title}</span>
          {!isCompleted && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </CollapsibleHeader>
      </CollapsibleTrigger>
    </Collapsible>
  );
}
