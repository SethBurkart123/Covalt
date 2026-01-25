import { FileCode2, Loader2 } from "lucide-react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleIcon,
  CollapsibleHeader,
} from "@/components/ui/collapsible";
import { useArtifactPanel } from "@/contexts/artifact-panel-context";
import type { ToolCallRendererProps } from "@/lib/tool-renderers/types";
import { EditableCodeViewer } from "./EditableCodeViewer";

function extensionToLanguage(ext?: string): string | undefined {
  if (!ext) return undefined;
  const normalized = ext.replace(/^\./, "").toLowerCase();
  switch (normalized) {
    case "js":
      return "javascript";
    case "jsx":
      return "jsx";
    case "ts":
      return "typescript";
    case "tsx":
      return "tsx";
    case "json":
      return "json";
    case "html":
      return "html";
    case "css":
      return "css";
    case "md":
      return "markdown";
    case "yml":
    case "yaml":
      return "yaml";
    case "py":
      return "python";
    case "sh":
      return "bash";
    default:
      return normalized;
  }
}

function inferLanguage(toolArgs: Record<string, unknown>): string {
  const fromArgs = (toolArgs.language as string) || (toolArgs.lang as string);
  if (typeof fromArgs === "string" && fromArgs.trim()) return fromArgs.trim();

  const filename = toolArgs.filename as string;
  if (typeof filename === "string" && filename.includes(".")) {
    const ext = filename.split(".").pop();
    const inferred = extensionToLanguage(ext);
    if (inferred) return inferred;
  }

  const ext = toolArgs.extension as string;
  const inferred = extensionToLanguage(typeof ext === "string" ? ext : undefined);
  return inferred || "text";
}


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
  const hasFile = !!filePath && !!chatId;
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

  const isEditable = renderPlan?.config?.editable === true && !!filePath && !!chatId;

  const handleClick = () => {
    if (!isCompleted) return;
    
    if (hasFile && filePath) {
      openFile(filePath);
    }
    
    if (isEditable && filePath) {
      open(
        toolCallId || `${toolName}-${title}`,
        title,
        <EditableCodeViewer
          language={language}
          filePath={filePath}
        />,
        filePath
      );
    } else if (hasFile && filePath) {
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

  const isLoading = !isCompleted || (hasFile && fileState?.isLoading);

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
