"use client";

import { useEffect, useRef, useState } from "react";
import { MarkdownRenderer } from "./MarkdownRenderer";
import ToolCall from "./ToolCall";
import ThinkingCall from "./ThinkingCall";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleHeader,
  CollapsibleContent,
} from "@/components/ui/collapsible";
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
  const [isOpen, setIsOpen] = useState(false);
  const [isManuallyExpanded, setIsManuallyExpanded] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const userInteractedRef = useRef(false);

  useEffect(() => {
    if (alwaysOpen) return;
    if (active) {
      setIsManuallyExpanded(false);
      userInteractedRef.current = false;
      setIsClosing(false);
    }
  }, [active, alwaysOpen]);

  useEffect(() => {
    if (alwaysOpen) return;
    if (active && !userInteractedRef.current) {
      setIsOpen(true);
    } else if (!active && isOpen && !isManuallyExpanded && !userInteractedRef.current) {
      setIsClosing(true);
      const timer = setTimeout(() => {
        setIsOpen(false);
        setIsClosing(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [active, alwaysOpen, isOpen, isManuallyExpanded]);

  useEffect(() => {
    if (active && !isManuallyExpanded && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [content, active, isManuallyExpanded]);

  const handleToggle = () => {
    if (alwaysOpen) return;
    userInteractedRef.current = true;
    if (active && isOpen && !isManuallyExpanded) {
      setIsManuallyExpanded(true);
    } else {
      setIsOpen(!isOpen);
      if (isOpen) setIsManuallyExpanded(false);
    }
  };

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
  const isOpenState = alwaysOpen ? true : isOpen;
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
      open={isOpenState}
      onOpenChange={alwaysOpen ? undefined : setIsOpen}
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
                  toolName={block.toolName}
                  toolArgs={block.toolArgs}
                  toolResult={block.toolResult}
                  isCompleted={block.isCompleted}
                  renderer={block.renderer}
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
