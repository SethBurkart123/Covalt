"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEventContent(content: unknown): Record<string, unknown> | null {
  if (typeof content !== "string") return null;
  try {
    const parsed = JSON.parse(content);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseOutputs(value: unknown): Record<string, FlowOutputPortSnapshot> | undefined {
  if (!isRecord(value)) return undefined;

  const outputs: Record<string, FlowOutputPortSnapshot> = {};
  for (const [port, portValue] of Object.entries(value)) {
    if (!isRecord(portValue)) continue;
    outputs[port] = {
      type: typeof portValue.type === "string" ? portValue.type : undefined,
      value: "value" in portValue ? portValue.value : undefined,
    };
  }

  return Object.keys(outputs).length > 0 ? outputs : undefined;
}

interface AgentTestChatContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  lastExecutionByNode: Record<string, FlowNodeExecutionSnapshot>;
  clearLastExecution: () => void;
  recordFlowEvent: (event: string, payload: Record<string, unknown>) => void;
}

const AgentTestChatContext = createContext<AgentTestChatContextValue | null>(null);

export function AgentTestChatProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [lastExecutionByNode, setLastExecutionByNode] = useState<Record<string, FlowNodeExecutionSnapshot>>({});

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);
  const clearLastExecution = useCallback(() => setLastExecutionByNode({}), []);

  const recordFlowEvent = useCallback((event: string, payload: Record<string, unknown>) => {
    const sessionId = payload.sessionId;
    const isFlowRunStarted =
      event === "RunStarted" && typeof sessionId === "string" && sessionId.length > 0;
    if (isFlowRunStarted) {
      setLastExecutionByNode({});
      return;
    }

    if (
      event !== "FlowNodeStarted" &&
      event !== "FlowNodeCompleted" &&
      event !== "FlowNodeResult" &&
      event !== "FlowNodeError"
    ) {
      return;
    }

    const eventData = parseEventContent(payload.content) ?? payload;
    const nodeId = typeof eventData.nodeId === "string" ? eventData.nodeId : null;
    if (!nodeId) return;

    const nodeType = typeof eventData.nodeType === "string" ? eventData.nodeType : undefined;
    const outputs = parseOutputs(eventData.outputs);
    const error = typeof eventData.error === "string" ? eventData.error : undefined;

    setLastExecutionByNode((current) => {
      const now = Date.now();
      const previous = current[nodeId];
      const next: FlowNodeExecutionSnapshot = {
        nodeId,
        nodeType: nodeType ?? previous?.nodeType,
        status:
          event === "FlowNodeStarted"
            ? "running"
            : event === "FlowNodeCompleted"
              ? "completed"
              : event === "FlowNodeError"
                ? "error"
                : previous?.status ?? "idle",
        outputs: outputs ?? previous?.outputs,
        error: error ?? previous?.error,
        updatedAt: now,
      };

      return {
        ...current,
        [nodeId]: next,
      };
    });
  }, []);

  return (
    <AgentTestChatContext.Provider
      value={{
        isOpen,
        open,
        close,
        toggle,
        lastExecutionByNode,
        clearLastExecution,
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
