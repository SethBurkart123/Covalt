"use client";

import { useMemo, useState, type ReactNode } from "react";
import { FileText } from "lucide-react";
import { Prism } from "prism-react-renderer";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleIcon,
  CollapsibleHeader,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import type { ToolCallRendererProps } from "@/lib/tool-renderers/types";
import { cn } from "@/lib/utils";
import { MiddleTruncate } from "@/components/ui/middle-truncate";
import { detectLanguage } from "./detect-language";

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function extractContent(
  config: Record<string, unknown> | undefined,
  toolResult: unknown,
): string {
  const fromConfig = asString(config?.content);
  if (fromConfig !== undefined) return fromConfig;
  if (typeof toolResult === "string") {
    const parsed = tryParse(toolResult);
    if (parsed && typeof parsed === "object") {
      const fromParsed = asString((parsed as Record<string, unknown>).content);
      if (fromParsed !== undefined) return fromParsed;
    }
    return toolResult;
  }
  if (toolResult && typeof toolResult === "object") {
    const fromObj = asString((toolResult as Record<string, unknown>).content);
    if (fromObj !== undefined) return fromObj;
  }
  return "";
}

function extractPath(
  config: Record<string, unknown> | undefined,
  toolArgs: Record<string, unknown> | undefined,
): string {
  return (
    asString(config?.path)
    ?? asString(toolArgs?.path)
    ?? asString(toolArgs?.file)
    ?? asString(toolArgs?.filePath)
    ?? asString(toolArgs?.file_path)
    ?? ""
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function highlightCode(text: string, language: string): string {
  const grammar = Prism.languages[language] ?? Prism.languages.text;
  if (!grammar) return escapeHtml(text);
  return Prism.highlight(text, grammar, language);
}

function shouldHighlight(content: string, lineCount: number): boolean {
  if (content.length > 250_000) return false;
  if (lineCount > 2_500) return false;
  return true;
}

export function FileReadRenderer({
  toolArgs,
  toolResult,
  renderPlan,
  isGrouped = false,
  isFirst = false,
  isLast = false,
  mode = "regular",
}: ToolCallRendererProps): ReactNode {
  const config = renderPlan?.config;
  const path = useMemo(() => extractPath(config, toolArgs), [config, toolArgs]);
  const content = useMemo(() => extractContent(config, toolResult), [config, toolResult]);
  const startLine = asNumber(config?.startLine);
  const endLine = asNumber(config?.endLine);
  const languageOverride = asString(config?.language);

  const resolvedLanguage = useMemo(() => {
    const lang = detectLanguage(path, languageOverride);
    return lang === "plaintext" ? "text" : lang;
  }, [path, languageOverride]);

  const lineCount = useMemo(
    () => (content.length === 0 ? 0 : content.split("\n").length),
    [content],
  );
  const highlight = useMemo(
    () => shouldHighlight(content, lineCount),
    [content, lineCount],
  );
  const lineNumberStart = startLine ?? 1;
  const maxLineNo = lineNumberStart + Math.max(0, lineCount - 1);
  const gutterWidth = Math.max(2, String(maxLineNo).length) + 1;

  const highlightedLines = useMemo(() => {
    if (content.length === 0) return [] as string[];
    if (!highlight) return content.split("\n").map((ln) => escapeHtml(ln));
    return content.split("\n").map((ln) => highlightCode(ln, resolvedLanguage));
  }, [content, resolvedLanguage, highlight]);

  const [isOpen, setIsOpen] = useState(false);

  const rightContent = (
    <span className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
      {(startLine !== undefined || endLine !== undefined) && (
        <span data-testid="file-read-line-range">
          L{startLine ?? 1}
          {endLine !== undefined ? `-${endLine}` : ""}
        </span>
      )}
      <span data-testid="file-read-line-count">
        {lineCount} {lineCount === 1 ? "line" : "lines"}
      </span>
    </span>
  );

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      isGrouped={isGrouped}
      isFirst={isFirst}
      isLast={isLast}
      mode={mode}
      data-testid="file-read-renderer"
      data-toolcall
    >
      <CollapsibleTrigger rightContent={rightContent}>
        <CollapsibleHeader>
          <CollapsibleIcon icon={FileText} />
          <MiddleTruncate
            data-testid="file-read-path"
            text={path || "(unknown path)"}
            className="flex-1 text-sm font-mono text-foreground"
          />
        </CollapsibleHeader>
      </CollapsibleTrigger>

      <CollapsibleContent className="p-0 space-y-0">
        {content.length === 0 ? (
          <div
            data-testid="file-read-empty"
            className="px-3 py-3 text-sm text-muted-foreground"
          >
            (empty file)
          </div>
        ) : (
          <div
            data-testid="file-read-code"
            className="max-h-[32rem] overflow-auto"
          >
            <pre className="code-tokens m-0 text-xs leading-5 font-mono">
              {highlightedLines.map((html, i) => (
                <div key={i} className="flex items-start">
                  <span
                    className="select-none shrink-0 px-2 text-right text-muted-foreground/60"
                    style={{ width: `${gutterWidth}ch` }}
                    aria-hidden="true"
                  >
                    {lineNumberStart + i}
                  </span>
                  <span
                    className={cn("flex-1 min-w-0 whitespace-pre-wrap break-all pr-3")}
                    dangerouslySetInnerHTML={{ __html: html.length === 0 ? "&nbsp;" : html }}
                  />
                </div>
              ))}
            </pre>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export default FileReadRenderer;
