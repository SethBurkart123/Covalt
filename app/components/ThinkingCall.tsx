"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Brain } from "lucide-react";
import { MarkdownRenderer } from "./MarkdownRenderer";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleIcon,
  CollapsibleHeader,
  CollapsibleContent,
} from "@/components/ui/collapsible";

interface ThinkingCallProps {
  content: string;
  active?: boolean;
  startAt?: number;
  finalElapsedMs?: number;
  isGrouped?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
}

function formatMs(ms: number): string {
  const secs = Math.max(0, Math.floor((ms / 1000) % 60));
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export default function ThinkingCall({
  content,
  active = false,
  startAt,
  finalElapsedMs,
  isGrouped = false,
  isFirst = false,
  isLast = false,
}: ThinkingCallProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [elapsed, setElapsed] = useState<number>(finalElapsedMs || 0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (active && startAt) {
      const tick = () => setElapsed(Date.now() - startAt);
      tick();
      timerRef.current = window.setInterval(tick, 1000);
      return () => {
        if (timerRef.current) window.clearInterval(timerRef.current);
        timerRef.current = null;
      };
    } else if (finalElapsedMs != null) {
      setElapsed(finalElapsedMs);
    }
  }, [active, startAt, finalElapsedMs]);

  const rightTimer = useMemo(() => {
    if (active) return formatMs(elapsed);
    if (!active && finalElapsedMs != null) return formatMs(finalElapsedMs);
    return undefined;
  }, [active, elapsed, finalElapsedMs]);

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      isGrouped={isGrouped}
      isFirst={isFirst}
      isLast={isLast}
      shimmer={active}
      data-thinkingcall
    >
      <CollapsibleTrigger
        rightContent={
          rightTimer && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {rightTimer}
            </span>
          )
        }
      >
        <CollapsibleHeader>
          <CollapsibleIcon icon={Brain} />
          <span className="text-sm font-mono text-foreground">Thinking</span>
        </CollapsibleHeader>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <MarkdownRenderer content={content} />
      </CollapsibleContent>
    </Collapsible>
  );
}
