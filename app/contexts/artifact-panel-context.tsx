"use client";

import React, { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from "react";
import { useSidebar } from "@/components/ui/sidebar";
import { useChat } from "@/contexts/chat-context";

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
  const { open: sidebarOpen, setOpen: setSidebarOpen } = useSidebar();
  const wasSidebarOpenRef = useRef<boolean | null>(null);
  const { chatId } = useChat();
  const prevChatIdRef = useRef<string>("");

  const open = useCallback((id: string, title: string, content: ReactNode) => {
    const isFirstArtifact = artifacts.length === 0;
    setArtifacts((prev) => {
      const existing = prev.find((a) => a.id === id);
      if (existing) {
        return prev.map((a) => (a.id === id ? { ...a, title, content } : a));
      }
      return [...prev, { id, title, content }];
    });
    setActiveId(id);
    if (isFirstArtifact) {
      wasSidebarOpenRef.current = sidebarOpen;
      setSidebarOpen(false);
    }
  }, [artifacts.length, sidebarOpen, setSidebarOpen]);

  const close = useCallback(() => {
    setArtifacts([]);
    setActiveId(null);
    if (wasSidebarOpenRef.current) {
      setSidebarOpen(true);
      wasSidebarOpenRef.current = null;
    }
  }, [setSidebarOpen]);

  const setActive = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const remove = useCallback((id: string) => {
    setArtifacts((prev) => {
      const next = prev.filter((a) => a.id !== id);
      if (next.length === 0) {
        setActiveId(null);
        if (wasSidebarOpenRef.current) {
          setSidebarOpen(true);
          wasSidebarOpenRef.current = null;
        }
      } else if (activeId === id) {
        setActiveId(next[next.length - 1].id);
      }
      return next;
    });
  }, [activeId, setSidebarOpen]);

  useEffect(() => {
    if (prevChatIdRef.current !== "" && prevChatIdRef.current !== chatId) {
      close();
    }
    prevChatIdRef.current = chatId;
  }, [chatId, close]);

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
