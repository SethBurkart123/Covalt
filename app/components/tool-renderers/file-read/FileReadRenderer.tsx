"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, Copy, FileText } from "lucide-react";
import { Highlight, themes, type Language } from "prism-react-renderer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useResolvedTheme } from "@/hooks/use-resolved-theme";
import type { ToolRendererProps } from "@/lib/renderers/types";
import { cn } from "@/lib/utils";
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
  toolResult: string | undefined,
): string {
  const fromConfig = asString(config?.content);
  if (fromConfig !== undefined) return fromConfig;
  if (toolResult === undefined) return "";
  const parsed = tryParse(toolResult);
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const fromParsed = asString(obj.content);
    if (fromParsed !== undefined) return fromParsed;
  }
  return toolResult;
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

interface CopyButtonProps {
  content: string;
}

function CopyButton({ content }: CopyButtonProps): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (error) {
      console.error("[FileReadRenderer] copy failed", error);
    }
  }, [content]);

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={handleCopy}
      data-testid="file-read-copy"
      aria-label="Copy file contents"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

export function FileReadRenderer({
  toolCall,
  config,
}: ToolRendererProps): React.ReactElement {
  const path = extractPath(config, toolCall.toolArgs);
  const content = extractContent(config, toolCall.toolResult);
  const startLine = asNumber(config?.startLine);
  const endLine = asNumber(config?.endLine);
  const languageOverride = asString(config?.language);
  const language = useMemo(
    () => detectLanguage(path, languageOverride) as Language,
    [path, languageOverride],
  );
  const isDark = useResolvedTheme() === "dark";
  const theme = isDark ? themes.vsDark : themes.vsLight;
  const lines = useMemo(
    () => (content.length === 0 ? 0 : content.split("\n").length),
    [content],
  );
  const lineNumberStart = startLine ?? 1;

  return (
    <Card className="p-0 gap-0 overflow-hidden" data-testid="file-read-renderer">
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <FileText className="h-4 w-4 text-muted-foreground" />
        <span
          className="text-xs font-mono text-foreground truncate"
          data-testid="file-read-path"
        >
          {path || "(unknown path)"}
        </span>
        {(startLine !== undefined || endLine !== undefined) && (
          <span
            className="text-xs px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground font-mono"
            data-testid="file-read-line-range"
          >
            L{startLine ?? 1}
            {endLine !== undefined ? `-${endLine}` : ""}
          </span>
        )}
        <span
          className="ml-auto text-xs text-muted-foreground"
          data-testid="file-read-line-count"
        >
          {lines} {lines === 1 ? "line" : "lines"}
        </span>
        <CopyButton content={content} />
      </div>
      {content.length === 0 ? (
        <div
          className="px-3 py-3 text-sm text-muted-foreground"
          data-testid="file-read-empty"
        >
          (empty file)
        </div>
      ) : (
        <div
          className="overflow-auto max-h-[32rem] text-xs"
          data-testid="file-read-code"
        >
          <Highlight code={content} language={language} theme={theme}>
            {({ className, style, tokens, getLineProps, getTokenProps }) => (
              <pre
                className={cn("p-3 m-0 font-mono leading-5", className)}
                style={style}
              >
                {tokens.map((line, i) => (
                  <div key={i} {...getLineProps({ line })}>
                    <span
                      className="inline-block w-10 pr-3 text-right select-none text-muted-foreground"
                      aria-hidden="true"
                    >
                      {lineNumberStart + i}
                    </span>
                    {line.map((token, key) => (
                      <span key={key} {...getTokenProps({ token })} />
                    ))}
                  </div>
                ))}
              </pre>
            )}
          </Highlight>
        </div>
      )}
    </Card>
  );
}

export default FileReadRenderer;
