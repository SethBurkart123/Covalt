"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface AgentTestChatContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

const AgentTestChatContext = createContext<AgentTestChatContextValue | null>(null);

export function AgentTestChatProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  return (
    <AgentTestChatContext.Provider value={{ isOpen, open, close, toggle }}>
      {children}
    </AgentTestChatContext.Provider>
  );
}

export function useAgentTestChat() {
  const context = useContext(AgentTestChatContext);
  if (!context) {
    throw new Error("useAgentTestChat must be used within AgentTestChatProvider");
  }
  return context;
}
