
import { FileText, Loader2 } from "lucide-react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleIcon,
  CollapsibleHeader,
} from "@/components/ui/collapsible";
import { EditableMarkdownViewer } from "@/components/EditableMarkdownViewer";
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
  const { toggle, activeId, openFile, getFileState } = useArtifactPanel();

  const filePath = renderPlan?.config?.file;
  const hasFile = !!filePath && !!chatId;
  const fileState = filePath ? getFileState(filePath) : undefined;
  const titleFromArgs = typeof toolArgs.title === "string" ? toolArgs.title : "";
  const title = titleFromArgs || filePath || toolName;
  const isEditable = renderPlan?.config?.editable !== false && hasFile;
  const content = filePath && fileState?.content
    ? fileState.content
    : renderPlan?.config?.content
      ? String(renderPlan.config.content)
      : typeof toolResult === "string"
        ? toolResult
        : "";
  const toolCallTestId = `tool-call-${toolName}`;

  const artifactId = toolCallId || `${toolName}-${title}`;

  const handleClick = () => {
    if (!isCompleted || (!content && !fileState)) return;

    const isClosing = activeId === artifactId;
    if (hasFile && filePath && !isClosing) openFile(filePath);

    toggle(
      artifactId,
      title,
      filePath
        ? <EditableMarkdownViewer filePath={filePath} readOnly={!isEditable} />
        : <EditableMarkdownViewer content={content} readOnly />,
      filePath
    );
  };

  const isLoading = !isCompleted || Boolean(hasFile && fileState?.isLoading);

  return (
    <Collapsible
      isGrouped={isGrouped}
      isFirst={isFirst}
      isLast={isLast}
      shimmer={isLoading}
      disableToggle
      data-testid={toolCallTestId}
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
