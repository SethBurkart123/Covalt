"use client";

import { useRef, useState, useCallback, useLayoutEffect } from "react";
import { X } from "lucide-react";
import { motion } from "motion/react";
import { useArtifactPanel } from "@/contexts/artifact-panel-context";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const TRANSITION = {
  type: "spring" as const,
  stiffness: 231,
  damping: 28,
};

function computeFinalInsetWidth(sidebarExpanded: boolean): number {
  const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return sidebarExpanded
    ? window.innerWidth - 19 * remPx - 0.5 * remPx
    : window.innerWidth - remPx;
}

export function ArtifactPanel() {
  const { isOpen, artifacts, activeId, setActive, remove, close, clearFiles } =
    useArtifactPanel();
  const { state: sidebarState } = useSidebar();

  const displayArtifactsRef = useRef(artifacts);
  const displayActiveRef = useRef(artifacts.find((a) => a.id === activeId));
  const wasOpenRef = useRef(isOpen);

  const containerRef = useRef<HTMLDivElement>(null);
  const [lockedWidth, setLockedWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (isOpen && lockedWidth === null && !wasOpenRef.current) {
      setLockedWidth(computeFinalInsetWidth(false) * 0.5);
      return;
    }
    if (!isOpen && lockedWidth === null && wasOpenRef.current) {
      const inner = containerRef.current?.firstElementChild as HTMLElement | null;
      const measured = inner?.getBoundingClientRect().width;
      if (typeof measured === "number" && measured > 0) {
        setLockedWidth(measured);
      } else {
        setLockedWidth(computeFinalInsetWidth(sidebarState === "expanded") * 0.5);
      }
    }
  }, [isOpen, lockedWidth, sidebarState]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const onResize = () => {
      if (lockedWidth === null) return;
      setLockedWidth(computeFinalInsetWidth(sidebarState === "expanded") * 0.5);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isOpen, sidebarState, lockedWidth]);

  const handleAnimationComplete = useCallback(() => {
    if (wasOpenRef.current && !isOpen) {
      setLockedWidth(null);
      clearFiles();
    } else if (isOpen) {
      setLockedWidth(null);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, clearFiles]);

  if (artifacts.length > 0) {
    displayArtifactsRef.current = artifacts;
    displayActiveRef.current = artifacts.find((a) => a.id === activeId);
  }

  return (
    <motion.div
      ref={containerRef}
      className="overflow-hidden"
      initial={false}
      animate={{ width: isOpen ? "50%" : 0 }}
      transition={TRANSITION}
      onAnimationComplete={handleAnimationComplete}
    >
      <div
        data-testid="artifact-panel"
        className="h-full bg-card/80 border-l border-border rounded-l-xl flex flex-col overflow-hidden"
        style={lockedWidth ? { width: lockedWidth } : undefined}
      >
        <div className="flex border-b border-border overflow-x-auto p-2 gap-2 px-4">
          {displayArtifactsRef.current.length !== 1 ? (
            displayArtifactsRef.current.map((artifact) => (
              <button
                key={artifact.id}
                onClick={() => setActive(artifact.id)}
                className={cn(
                  "flex items-center gap-2 px-4 py-1 text-sm whitespace-nowrap transition-colors rounded-lg",
                  artifact.id === activeId
                    ? "bg-background/50 text-foreground"
                    : "text-muted-foreground hover:bg-background/25",
                )}
              >
                <span className="truncate max-w-[150px]">{artifact.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(artifact.id);
                  }}
                  className="p-0.5 rounded hover:bg-muted"
                >
                  <X size={12} />
                </button>
              </button>
            ))
          ) : (
            <div className="flex-1 flex items-center">
              <p className="font-medium">
                {displayArtifactsRef.current[0].title}
              </p>
            </div>
          )}

          <button
            onClick={close}
            className="p-3 rounded hover:bg-muted ml-auto"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-auto flex flex-col">
          {displayActiveRef.current?.content}
        </div>
      </div>
    </motion.div>
  );
}
