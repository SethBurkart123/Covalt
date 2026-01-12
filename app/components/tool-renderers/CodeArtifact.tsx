import React from "react";
import { FileCode2, Copy, Check } from "lucide-react";
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
          {({ className, style, tokens, getLineProps, getTokenProps }: any) => (
            <div className="flex">
              <div className="flex-shrink-0">
                {tokens.map((_line: any, i: number) => (
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
                {tokens.map((line: any, i: number) => (
                  <div
                    key={i}
                    {...getLineProps({ line })}
                    className="px-3 py-1"
                  >
                    {line.map((token: any, key: number) => (
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

export function CodeArtifact({
  toolName,
  toolArgs,
  toolResult,
  isCompleted,
  toolCallId,
  isGrouped = false,
  isFirst = false,
  isLast = false,
}: ToolCallRendererProps) {
  const { open } = useArtifactPanel();

  const title =
    (toolArgs.title as string) ||
    (toolArgs.filename as string) ||
    toolName;
  const id = toolCallId || `${toolName}-${title}`;

  const code = typeof toolResult === "string" && toolResult.length > 0
    ? toolResult
    : (toolArgs.code as string) || "";

  const language = inferLanguage(toolArgs);

  const handleClick = () => {
    if (!isCompleted || !code) return;
    open(id, title, <CodeViewer code={code} language={language} />);
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
          <CollapsibleIcon icon={FileCode2} />
          <span className="text-sm font-medium text-foreground">{title}</span>
          <span className="text-xs text-muted-foreground">{language}</span>
          {!isCompleted && (
            <span className="text-xs text-muted-foreground">generating...</span>
          )}
        </CollapsibleHeader>
      </CollapsibleTrigger>
    </Collapsible>
  );
}
