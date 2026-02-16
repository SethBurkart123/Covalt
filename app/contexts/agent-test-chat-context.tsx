"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { useFlowExecution } from "@/contexts/flow-execution-context";

export interface FlowOutputPortSnapshot {
  type?: string;
  value: unknown;
}

export interface FlowNodeExecutionSnapshot {
  nodeId: string;
  nodeType?: string;
  status: "idle" | "running" | "completed" | "error";
  outputs?: Record<string, FlowOutputPortSnapshot>;
  error?: string;
  updatedAt: number;
}

interface AgentTestChatContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  clearLastExecution: () => void;
  clearRunningExecution: () => void;
  recordFlowEvent: (event: string, payload: Record<string, unknown>) => void;
}

const AgentTestChatContext = createContext<AgentTestChatContextValue | null>(null);

export function AgentTestChatProvider({
  children,
}: {
  children: ReactNode;
  agentId?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const {
    clearExecution,
    clearRunningExecution,
    recordFlowEvent: recordExecutionEvent,
  } = useFlowExecution();

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);
  const clearLastExecution = useCallback(() => clearExecution(), [clearExecution]);
  const clearRunningExecutionSafe = useCallback(
    () => clearRunningExecution(),
    [clearRunningExecution]
  );

  const recordFlowEvent = useCallback(
    (event: string, payload: Record<string, unknown>) => {
      recordExecutionEvent(event, payload);
    },
    [recordExecutionEvent]
  );

  return (
    <AgentTestChatContext.Provider
      value={{
        isOpen,
        open,
        close,
        toggle,
        clearLastExecution,
        clearRunningExecution: clearRunningExecutionSafe,
        recordFlowEvent,
      }}
    >
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
