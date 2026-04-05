"use client";

import { useEffect, useRef } from "react";
import { MarkdownRenderer } from "./MarkdownRenderer";
import ToolCall from "./ToolCall";
import ThinkingCall from "./ThinkingCall";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleHeader,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { useAutoCollapse } from "@/lib/hooks/use-auto-collapse";
import type { ContentBlock } from "@/lib/types/chat";

interface MemberRunCallProps {
  memberName: string;
  nodeId?: string;
  content: ContentBlock[];
  active?: boolean;
  isGrouped?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
  isCompleted?: boolean;
  hasError?: boolean;
  alwaysOpen?: boolean;
  compact?: boolean;
}

export default function MemberRunCall({
  memberName,
  content,
  active = false,
  isGrouped = false,
  isFirst = false,
  isLast = false,
  isCompleted = false,
  hasError = false,
  alwaysOpen = false,
  compact = false,
}: MemberRunCallProps) {
  const { isOpen, isClosing, isManuallyExpanded, setIsOpen, handleToggle } =
    useAutoCollapse({ active, disabled: alwaysOpen });
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (active && !isManuallyExpanded && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [content, active, isManuallyExpanded]);

  const activeTools = content.filter(
    (b): b is Extract<ContentBlock, { type: "tool_call" }> =>
      b.type === "tool_call" && !b.isCompleted,
  );
  const rightLabel = hasError
    ? undefined
    : activeTools.length > 0
      ? `Running ${activeTools[0].toolName}${activeTools.length > 1 ? ` +${activeTools.length - 1}` : ""}`
      : undefined;
  const nameLabel = memberName || "Agent";
  const mode = compact || alwaysOpen ? "compact" : "regular";

  if (hasError) {
    return (
      <Collapsible
        open={false}
        isGrouped={isGrouped}
        isFirst={isFirst}
        isLast={isLast}
        disableToggle
        mode={mode}
      >
        <CollapsibleTrigger>
          <CollapsibleHeader>
            <span className="text-sm font-mono text-foreground">{nameLabel}</span>
            <span className="text-xs px-2 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-400">
              Failed
            </span>
          </CollapsibleHeader>
        </CollapsibleTrigger>
      </Collapsible>
    );
  }

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      isGrouped={isGrouped}
      isFirst={isFirst}
      isLast={isLast}
      shimmer={active}
      disableToggle={alwaysOpen}
      mode={mode}
    >
      <CollapsibleTrigger
        onClick={handleToggle}
        overrideIsOpenPreview={isCompleted ? undefined : isManuallyExpanded}
        rightContent={
          rightLabel ? (
            <span className="text-xs text-muted-foreground font-mono mr-1 truncate max-w-40">
              {rightLabel}
            </span>
          ) : undefined
        }
      >
        <CollapsibleHeader>
          <span className="text-sm font-mono text-foreground">{nameLabel}</span>
        </CollapsibleHeader>
      </CollapsibleTrigger>

      <CollapsibleContent className={(active || isClosing) && !isManuallyExpanded && !alwaysOpen ? "pt-0" : ""}>
        <div
          ref={contentRef}
          className={(active || isClosing) && !isManuallyExpanded && !alwaysOpen ? "max-h-48 overflow-y-auto pt-2" : ""}
        >
          {content.map((block, i) => {
            if (block.type === "text") {
              return block.content ? (
                <MarkdownRenderer key={`text-${i}`} content={block.content} />
              ) : null;
            }
            if (block.type === "tool_call") {
              return (
                <ToolCall
                  key={block.id || `tool-${i}`}
                  id={block.id}
                  toolName={block.toolName}
                  toolArgs={block.toolArgs}
                  toolResult={block.toolResult}
                  isCompleted={block.isCompleted}
                  toolCallId={block.toolCallId || block.id}
                  renderPlan={block.renderPlan}
                  failed={block.failed}
                  mode="minimal"
                />
              );
            }
            if (block.type === "reasoning") {
              return (
                <ThinkingCall
                  key={`reason-${i}`}
                  content={block.content}
                  active={!block.isCompleted}
                  isCompleted={block.isCompleted}
                  mode="minimal"
                />
              );
            }
            if (block.type === "error") {
              return (
                <div key={`error-${i}`} className="text-sm text-destructive px-1 py-1">
                  {block.content}
                </div>
              );
            }
            return null;
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
