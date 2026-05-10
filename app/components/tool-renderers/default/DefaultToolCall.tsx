"use client";

import { useState } from "react";
import { Wrench } from "lucide-react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleIcon,
  CollapsibleHeader,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import type { ToolCallRendererProps } from "@/lib/tool-renderers/types";
import { parseToolDisplayParts } from "@/lib/tooling";
import { ArgumentsDisplay } from "./ArgumentsDisplay";
import { ResultRenderer } from "./ResultRenderer";

export function DefaultToolCall({
  toolName,
  toolArgs,
  toolResult,
  isCompleted,
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
          <CollapsibleIcon icon={Wrench} />
          <span className="text-sm font-mono text-foreground">
            {toolDisplay.namespace ? (
              <>
                <span>{toolDisplay.label}</span>
                <span className="px-2 italic text-muted-foreground align-middle">
                  {toolDisplay.namespace}
                </span>
              </>
            ) : (
              toolDisplay.label
            )}
          </span>
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
