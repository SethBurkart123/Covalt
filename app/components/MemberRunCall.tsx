"use client";

import { useEffect, useRef, useState } from "react";
import { Bot } from "lucide-react";
import { MarkdownRenderer } from "./MarkdownRenderer";
import ToolCall from "./ToolCall";
import ThinkingCall from "./ThinkingCall";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleIcon,
  CollapsibleHeader,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import type { ContentBlock } from "@/lib/types/chat";

interface MemberRunCallProps {
  memberName: string;
  content: ContentBlock[];
  active?: boolean;
  isGrouped?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
  isCompleted?: boolean;
}

export default function MemberRunCall({
  memberName,
  content,
  active = false,
  isGrouped = false,
  isFirst = false,
  isLast = false,
  isCompleted = false,
}: MemberRunCallProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isManuallyExpanded, setIsManuallyExpanded] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const userInteractedRef = useRef(false);

  useEffect(() => {
    if (active) {
      setIsManuallyExpanded(false);
      userInteractedRef.current = false;
      setIsClosing(false);
    }
  }, [active]);

  useEffect(() => {
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
  }, [active, isOpen, isManuallyExpanded]);

  useEffect(() => {
    if (active && !isManuallyExpanded && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [content, active, isManuallyExpanded]);

  const handleToggle = () => {
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
  const rightLabel = activeTools.length > 0
    ? `Running ${activeTools[0].toolName}${activeTools.length > 1 ? ` +${activeTools.length - 1}` : ""}`
    : undefined;

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      isGrouped={isGrouped}
      isFirst={isFirst}
      isLast={isLast}
      shimmer={active}
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
          <CollapsibleIcon icon={Bot} />
          <span className="text-sm font-mono text-foreground">{memberName || "Member"}</span>
        </CollapsibleHeader>
      </CollapsibleTrigger>

      <CollapsibleContent className={(active || isClosing) && !isManuallyExpanded ? "pt-0" : ""}>
        <div
          ref={contentRef}
          className={(active || isClosing) && !isManuallyExpanded ? "max-h-48 overflow-y-auto pt-2" : ""}
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
            return null;
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
