"use client";

import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";

export interface Artifact {
  id: string;
  title: string;
  content: ReactNode;
}

interface ArtifactPanelContextValue {
  isOpen: boolean;
  artifacts: Artifact[];
  activeId: string | null;
  open: (id: string, title: string, content: ReactNode) => void;
  close: () => void;
  setActive: (id: string) => void;
  remove: (id: string) => void;
}

const ArtifactPanelContext = createContext<ArtifactPanelContextValue | null>(null);

export function ArtifactPanelProvider({ children }: { children: ReactNode }) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const open = useCallback((id: string, title: string, content: ReactNode) => {
    setArtifacts((prev) => {
      const existing = prev.find((a) => a.id === id);
      if (existing) {
        return prev.map((a) => (a.id === id ? { ...a, title, content } : a));
      }
      return [...prev, { id, title, content }];
    });
    setActiveId(id);
  }, []);

  const close = useCallback(() => {
    setArtifacts([]);
    setActiveId(null);
  }, []);

  const setActive = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const remove = useCallback((id: string) => {
    setArtifacts((prev) => {
      const next = prev.filter((a) => a.id !== id);
      if (next.length === 0) {
        setActiveId(null);
      } else if (activeId === id) {
        setActiveId(next[next.length - 1].id);
      }
      return next;
    });
  }, [activeId]);

  return (
    <ArtifactPanelContext.Provider
      value={{
        isOpen: artifacts.length > 0,
        artifacts,
        activeId,
        open,
        close,
        setActive,
        remove,
      }}
    >
      {children}
    </ArtifactPanelContext.Provider>
  );
}

export function useArtifactPanel() {
  const context = useContext(ArtifactPanelContext);
  if (!context) {
    throw new Error("useArtifactPanel must be used within ArtifactPanelProvider");
  }
  return context;
}
