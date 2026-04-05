"use client";

import { useEffect, useRef } from "react";
import { Brain } from "lucide-react";
import { MarkdownRenderer } from "./MarkdownRenderer";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleIcon,
  CollapsibleHeader,
  CollapsibleContent,
  type CollapsibleMode,
} from "@/components/ui/collapsible";
import { useAutoCollapse } from "@/lib/hooks/use-auto-collapse";

interface ThinkingCallProps {
  content: string;
  active?: boolean;
  isGrouped?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
  isCompleted?: boolean;
  mode?: CollapsibleMode;
}

export default function ThinkingCall({
  content,
  active = false,
  isGrouped = false,
  isFirst = false,
  isLast = false,
  isCompleted = false,
  mode = "regular",
}: ThinkingCallProps) {
  const { isOpen, isClosing, isManuallyExpanded, setIsOpen, handleToggle } =
    useAutoCollapse({ active });
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (active && !isManuallyExpanded && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [content, active, isManuallyExpanded]);

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      isGrouped={isGrouped}
      isFirst={isFirst}
      isLast={isLast}
      shimmer={active}
      mode={mode}
      data-thinkingcall
    >
      <CollapsibleTrigger
        onClick={handleToggle}
        overrideIsOpenPreview={isCompleted ? undefined : isManuallyExpanded}
      >
        <CollapsibleHeader>
          <CollapsibleIcon icon={Brain} />
          <span className="text-sm font-mono text-foreground">Thinking</span>
        </CollapsibleHeader>
      </CollapsibleTrigger>

      <CollapsibleContent className={(active || isClosing) && !isManuallyExpanded ? "pt-0" : ""}>
        <div
          ref={contentRef}
          className={(active || isClosing) && !isManuallyExpanded ? "max-h-48 overflow-y-auto pt-2" : ""}
        >
          <MarkdownRenderer content={content} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
