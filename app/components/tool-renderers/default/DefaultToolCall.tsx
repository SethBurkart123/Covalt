"use client";

import { useState } from "react";
import {
  FileText,
  Folder,
  ListTodo,
  Search,
  SquareTerminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleIcon,
  CollapsibleHeader,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import type { ToolCallRendererProps } from "@/lib/tool-renderers/types";
import { parseToolDisplayParts } from "@/lib/tooling";
import { MiddleTruncate } from "@/components/ui/middle-truncate";
import { ArgumentsDisplay } from "./ArgumentsDisplay";
import { ResultRenderer } from "./ResultRenderer";

const ICONS: Record<string, LucideIcon> = {
  file: FileText,
  folder: Folder,
  list: ListTodo,
  search: Search,
  terminal: SquareTerminal,
  wrench: Wrench,
};

function valueAtPath(source: Record<string, unknown>, path: string): string {
  let current: unknown = source;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object") return "";
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current === "string") return current;
  if (typeof current === "number" || typeof current === "boolean") {
    return String(current);
  }
  return "";
}

function renderTitleTemplate(
  template: string | undefined,
  toolArgs: Record<string, unknown>,
  config: Record<string, unknown> | undefined,
): string | null {
  if (!template) return null;
  const sources = { ...toolArgs, config: config ?? {} };
  return template.replace(/\{([^{}]+)\}/g, (_match, key: string) =>
    valueAtPath(sources, key.trim()),
  );
}

export function DefaultToolCall({
  toolName,
  toolArgs,
  toolResult,
  isCompleted,
  renderPlan,
  display,
  failed = false,
  approvalStatus,
  isGrouped = false,
  isFirst = false,
  isLast = false,
  mode = "regular",
}: ToolCallRendererProps) {
  const failureFromResult =
    typeof toolResult === "string"
    && /^error\s+(executing|calling)\s+tool:/i.test(toolResult.trim());
  const isFailed = failed || failureFromResult;
  const [isOpen, setIsOpen] = useState(false);

  const toolDisplay = parseToolDisplayParts(toolName);
  const title = renderTitleTemplate(display?.title, toolArgs, renderPlan?.config);
  const headerLabel = title ?? toolDisplay.label;
  const Icon = ICONS[display?.icon ?? ""] ?? Wrench;
  const toolCallTestId = `tool-call-${toolName}`;
  const hasArgs = Object.keys(toolArgs || {}).length > 0;
  const hasResult = Boolean(isCompleted && toolResult);

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      isGrouped={isGrouped}
      isFirst={isFirst}
      isLast={isLast}
      shimmer={!isCompleted}
      mode={mode}
      data-testid={toolCallTestId}
      data-toolcall
    >
      <CollapsibleTrigger>
        <CollapsibleHeader>
          <CollapsibleIcon icon={Icon} />
          <MiddleTruncate
            text={headerLabel}
            className="flex-1 text-sm font-mono text-foreground"
          />
          {!title && toolDisplay.namespace && (
            <span className="shrink-0 px-2 text-sm font-mono italic text-muted-foreground align-middle">
              {toolDisplay.namespace}
            </span>
          )}
          {approvalStatus === "denied" && (
            <span className="text-xs px-2 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-400">
              Denied
            </span>
          )}
          {approvalStatus === "timeout" && (
            <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">
              Timed Out
            </span>
          )}
          {isFailed && (
            <span className="text-xs px-2 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-400">
              Failed
            </span>
          )}
        </CollapsibleHeader>
      </CollapsibleTrigger>

      <CollapsibleContent>
        {hasArgs && (
          <div>
            {hasResult && (
              <div className="text-xs font-medium text-muted-foreground mb-2">
                Arguments
              </div>
            )}
            <ArgumentsDisplay args={toolArgs} />
          </div>
        )}

        {hasResult && toolResult !== undefined && (
          <div className={!hasArgs ? "pt-0" : undefined}>
            {hasArgs && (
              <div className="text-xs font-medium text-muted-foreground mb-2">
                Result
              </div>
            )}
            <ResultRenderer content={toolResult} tone={isFailed ? "error" : "default"} />
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
