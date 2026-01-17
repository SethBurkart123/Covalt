import React from "react";
import { FileCode2, Copy, Check, Loader2, Pencil } from "lucide-react";
import { Highlight, themes } from "prism-react-renderer";
import { useTheme } from "@/contexts/theme-context";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleIcon,
  CollapsibleHeader,
} from "@/components/ui/collapsible";
import { useArtifactPanel } from "@/contexts/artifact-panel-context";
import type { ToolCallRendererProps } from "@/lib/tool-renderers/types";
import { cn } from "@/lib/utils";
import { EditableCodeViewer } from "./EditableCodeViewer";

interface HighlightRenderProps {
  className: string;
  style: React.CSSProperties;
  tokens: Array<Array<{ types: string[]; content: string; empty?: boolean }>>;
  getLineProps: (props: { line: Array<{ types: string[]; content: string }> }) => React.HTMLAttributes<HTMLDivElement>;
  getTokenProps: (props: { token: { types: string[]; content: string } }) => React.HTMLAttributes<HTMLSpanElement>;
}

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

function useResolvedTheme(): "light" | "dark" {
  const { theme } = useTheme();
  const [systemPreference, setSystemPreference] = React.useState<"light" | "dark">(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light",
  );

  React.useEffect(() => {
    if (theme !== "system" || typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      setSystemPreference(mediaQuery.matches ? "dark" : "light");
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    } else if (mediaQuery.addListener) {
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }
  }, [theme]);

  return theme === "system" ? systemPreference : theme;
}

function CodeViewer({ code, language }: { code: string; language: string }) {
  const resolvedTheme = useResolvedTheme();
  const [copied, setCopied] = React.useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full relative">
      <div className="h-0 sticky top-0">
        <div className="pt-2 pr-2">
          <button
            onClick={copyToClipboard}
            className="flex ml-auto items-center gap-2 text-xs px-2 py-1 rounded border border-border bg-background/50 hover:bg-background transition-colors"
            title="Copy code"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      <div className="overflow-hidden">
        <Highlight
          theme={
            resolvedTheme === "dark"
              ? themes.gruvboxMaterialDark
              : themes.gruvboxMaterialLight
          }
          code={code.replace(/\n$/, "")}
          language={language || "text"}
        >
          {({ className, style, tokens, getLineProps, getTokenProps }: HighlightRenderProps) => (
            <div className="flex">
              <div className="flex-shrink-0">
                {tokens.map((_line, i) => (
                  <div
                    key={i}
                    className="select-none text-muted-foreground px-3 py-1 text-right border-r border-border/50"
                    style={{ width: "3.5rem", minWidth: "3.5rem" }}
                  >
                    {i + 1}
                  </div>
                ))}
              </div>
              <pre
                className={cn("m-0 p-0 !bg-transparent overflow-x-scroll flex-1", className)}
                style={style}
              >
                {tokens.map((line, i) => (
                  <div
                    key={i}
                    {...getLineProps({ line })}
                    className="px-3 py-1"
                  >
                    {line.map((token, key) => (
                      <span key={key} {...getTokenProps({ token })} />
                    ))}
                  </div>
                ))}
              </pre>
            </div>
          )}
        </Highlight>
      </div>
    </div>
  );
}

function FileCodeViewer({ filePath, language, fallbackCode }: { filePath: string; language: string; fallbackCode: string }) {
  const { getFileState } = useArtifactPanel();
  const fileState = getFileState(filePath);
  
  const code = fileState?.content ?? fallbackCode;
  const isLoading = fileState?.isLoading && !fileState?.content;
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground p-8">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        Loading file...
      </div>
    );
  }
  
  return <CodeViewer code={code} language={language} />;
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
  const fileContent = fileState?.content;
  const isLoadingFile = fileState?.isLoading ?? false;

  const title =
    (toolArgs.title as string) ||
    (toolArgs.filename as string) ||
    filePath ||
    toolName;
  const id = toolCallId || `${toolName}-${title}`;

  let code = "";
  if (filePath && fileContent) {
    code = fileContent;
  } else if (renderPlan?.config?.content) {
    code = String(renderPlan.config.content);
  } else if (typeof toolResult === "string" && toolResult.length > 0) {
    code = toolResult;
  } else {
    code = (toolArgs.code as string) || "";
  }

  const language = renderPlan?.config?.language === "auto" 
    ? inferLanguage({ ...toolArgs, filename: filePath })
    : (renderPlan?.config?.language || inferLanguage(toolArgs));

  const isEditable = renderPlan?.config?.editable === true && !!filePath && !!chatId;

  const handleClick = () => {
    if (!isCompleted) return;
    
    if (hasFile && filePath) {
      openFile(filePath);
    }
    
    if (isEditable && filePath && chatId) {
      open(
        id,
        title,
        <EditableCodeViewer
          language={language}
          filePath={filePath}
          chatId={chatId}
        />,
        filePath
      );
    } else if (hasFile && filePath) {
      open(
        id,
        title,
        <FileCodeViewer filePath={filePath} language={language} fallbackCode={code} />,
        filePath
      );
    } else {
      if (!code) return;
      open(id, title, <CodeViewer code={code} language={language} />);
    }
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
          <CollapsibleIcon icon={FileCode2} />
          <span className="text-sm font-medium text-foreground">{title}</span>
          <span className="text-xs text-muted-foreground">{language}</span>
          {isEditable && !isLoading && (
            <span title="Editable">
              <Pencil className="h-3 w-3 text-muted-foreground" />
            </span>
          )}
          {isLoading && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </CollapsibleHeader>
      </CollapsibleTrigger>
    </Collapsible>
  );
}
