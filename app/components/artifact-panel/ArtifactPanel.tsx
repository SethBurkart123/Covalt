"use client";

import { X } from "lucide-react";
import { useArtifactPanel } from "@/contexts/artifact-panel-context";
import { cn } from "@/lib/utils";

export function ArtifactPanel() {
  const { isOpen, artifacts, activeId, setActive, remove, close } = useArtifactPanel();
  const activeArtifact = artifacts.find((a) => a.id === activeId);

  return (
    <div
      className={cn(
        "overflow-hidden transition-all duration-300 ease-out",
        isOpen ? "w-1/2" : "w-0"
      )}
    >
      <div className="w-full h-full bg-card/80 border-l border-border flex flex-col overflow-hidden">
        <div className="flex border-b border-border overflow-x-auto p-2 gap-2">
          {artifacts.map((artifact) => (
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

          <button onClick={close} className="p-3 rounded hover:bg-muted ml-auto">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {activeArtifact?.content}
        </div>
      </div>
    </div>
  );
}
