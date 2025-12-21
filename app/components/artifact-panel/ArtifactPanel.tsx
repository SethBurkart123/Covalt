"use client";

import { useRef } from "react";
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
  
  if (artifacts.length > 0) {
    displayArtifactsRef.current = artifacts;
    displayActiveRef.current = activeArtifact;
  }

  return (
    <motion.div
      className="overflow-hidden"
      initial={false}
      animate={{ width: isOpen ? "50%" : 0 }}
      transition={TRANSITION}
    >
      <div 
        className="h-full bg-card/80 border-l border-border flex flex-col overflow-hidden"
        style={{ width: "50vw" }}
      >
        <div className="flex border-b border-border overflow-x-auto p-2 gap-2">
          {displayArtifactsRef.current.map((artifact) => (
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
          ))}

          <button onClick={close} className="p-3 rounded hover:bg-muted ml-auto mr-2">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 px-8">
          {displayActiveRef.current?.content}
        </div>
      </div>
    </motion.div>
  );
}
