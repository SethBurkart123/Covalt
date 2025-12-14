"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Brain } from "lucide-react";
import { MarkdownRenderer } from "./MarkdownRenderer";

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
      // Start live timer
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

  if (isGrouped) {
    return (
      <div className="relative" data-thinkingcall>
        <div
          className="absolute left-7 top-0 bottom-0 z-10 w-px bg-border"
          style={{
            top: isFirst ? "2.2rem" : "0",
            bottom: isLast ? "calc(100% - 0.7rem)" : "0",
          }}
        />

        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`w-full px-4 py-3 flex items-center justify-between hover:bg-border/30 transition-colors relative ${active ? "shimmer" : ""}`}
        >
          <div className="flex items-center gap-2">
            <div className="size-6 p-0.5 flex justify-center items-center relative z-10">
              <Brain size={16} className="text-muted-foreground" />
            </div>
            <span className="text-sm font-mono text-foreground ml-2">
              Thinking
            </span>
          </div>
          <div className="flex items-center gap-2">
            {rightTimer && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {rightTimer}
              </span>
            )}
            <motion.div
              animate={{ rotate: isOpen ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDown size={16} className="text-muted-foreground" />
            </motion.div>
          </div>
        </button>

        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 270, damping: 30 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-3 space-y-3 pt-3 ml-9">
                <MarkdownRenderer content={content} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="my-3 not-prose" data-thinkingcall>
      <div className="border border-border rounded-lg overflow-hidden bg-card">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors ${active ? "shimmer" : ""}`}
        >
          <div className="flex items-center gap-2">
            <Brain size={16} className="text-muted-foreground" />
            <span className="text-sm font-mono text-foreground">Thinking</span>
          </div>
          <div className="flex items-center gap-2">
            {rightTimer && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {rightTimer}
              </span>
            )}
            <motion.div
              animate={{ rotate: isOpen ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDown size={16} className="text-muted-foreground" />
            </motion.div>
          </div>
        </button>

        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 270, damping: 30 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-3 space-y-3 border-t border-border pt-3">
                <MarkdownRenderer content={content} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
