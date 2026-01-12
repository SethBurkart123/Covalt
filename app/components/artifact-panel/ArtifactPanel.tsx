"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { X } from "lucide-react";
import { motion } from "framer-motion";
import { useArtifactPanel } from "@/contexts/artifact-panel-context";
import { cn } from "@/lib/utils";

export const TRANSITION = {
  type: "spring" as const,
  stiffness: 231,
  damping: 28
}

export function ArtifactPanel() {
  const { isOpen, artifacts, activeId, setActive, remove, close } = useArtifactPanel();
  const activeArtifact = artifacts.find((a) => a.id === activeId);
  
  const displayArtifactsRef = useRef(artifacts);
  const displayActiveRef = useRef(activeArtifact);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [animatingWidth, setAnimatingWidth] = useState<number | null>(null);
  
  const handleAnimationStart = useCallback(() => {
    const parent = containerRef.current?.parentElement;
    if (!parent) return;
    
    setAnimatingWidth(parent.clientWidth * 0.5);
    observerRef.current = new ResizeObserver(([entry]) => {
      setAnimatingWidth(entry.contentRect.width * 0.5);
    });
    observerRef.current.observe(parent);
  }, []);
  
  const handleAnimationComplete = useCallback(() => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    setAnimatingWidth(null);
  }, []);
  
  useEffect(() => {
    return () => observerRef.current?.disconnect();
  }, []);
  
  if (artifacts.length > 0) {
    displayArtifactsRef.current = artifacts;
    displayActiveRef.current = activeArtifact;
  }

  return (
    <motion.div
      ref={containerRef}
      className="overflow-hidden"
      initial={false}
      animate={{ width: isOpen ? "50%" : 0 }}
      transition={TRANSITION}
      onAnimationStart={handleAnimationStart}
      onAnimationComplete={handleAnimationComplete}
    >
      <div 
        className="h-full bg-card/80 border-l border-border rounded-l-2xl flex flex-col overflow-hidden"
        style={animatingWidth ? { width: animatingWidth } : undefined}
      >
        <div className="flex border-b border-border overflow-x-auto p-2 gap-2 px-4">
          {displayArtifactsRef.current.length !== 1 ?
              (displayArtifactsRef.current.map((artifact) => (
                <button
                  key={artifact.id}
                  onClick={() => setActive(artifact.id)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-1 text-sm whitespace-nowrap transition-colors rounded-lg",
                    artifact.id === activeId
                      ? "bg-background/50 text-foreground"
                      : "text-muted-foreground hover:bg-background/25"
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
              )))
              :
              <div className="flex-1 flex items-center">
                <p className="font-medium">{displayArtifactsRef.current[0].title}</p>
              </div>
            }

          <button onClick={close} className="p-3 rounded hover:bg-muted ml-auto">
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
