"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { api } from "@/lib/services/api";

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

interface ToolNodeRef {
  nodeId: string;
  nodeType?: string;
}

function toToolNodeRef(value: unknown): ToolNodeRef | null {
  if (!isRecord(value)) return null;
  const nodeId = typeof value.nodeId === "string" ? value.nodeId : null;
  if (!nodeId) return null;
  const nodeType = typeof value.nodeType === "string" ? value.nodeType : undefined;
  return { nodeId, nodeType };
}

function collectToolNodeRefs(payload: unknown): ToolNodeRef[] {
  if (!isRecord(payload)) return [];
  const direct = toToolNodeRef(payload);
  if (direct) return [direct];

  const tools = payload.tools;
  if (!Array.isArray(tools)) return [];
  return tools.map(toToolNodeRef).filter((tool): tool is ToolNodeRef => tool !== null);
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

export function AgentTestChatProvider({
  children,
  agentId,
}: {
  children: ReactNode;
  agentId?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [lastExecutionByNode, setLastExecutionByNode] = useState<Record<string, FlowNodeExecutionSnapshot>>({});
  const hasLiveUpdatesRef = useRef(false);

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
      event === "ToolCallStarted" ||
      event === "ToolCallCompleted" ||
      event === "ToolCallFailed" ||
      event === "ToolCallError" ||
      event === "ToolApprovalRequired" ||
      event === "ToolApprovalResolved"
    ) {
      const toolPayload = payload.tool;
      const refs = collectToolNodeRefs(toolPayload);
      if (refs.length === 0) return;

      hasLiveUpdatesRef.current = true;

      let status: FlowNodeExecutionSnapshot["status"] | null = null;
      let error: string | undefined;

      if (event === "ToolCallStarted" || event === "ToolApprovalRequired") {
        status = "running";
      } else if (event === "ToolCallCompleted") {
        status = "completed";
        if (isRecord(toolPayload) && typeof toolPayload.error === "string" && toolPayload.error) {
          status = "error";
          error = toolPayload.error;
        }
      } else if (event === "ToolCallFailed" || event === "ToolCallError") {
        status = "error";
        if (isRecord(toolPayload) && typeof toolPayload.error === "string") {
          error = toolPayload.error;
        }
      } else if (event === "ToolApprovalResolved") {
        if (isRecord(toolPayload)) {
          const approvalStatus = toolPayload.approvalStatus;
          if (approvalStatus === "denied" || approvalStatus === "timeout") {
            status = "error";
            error = typeof approvalStatus === "string" ? `Approval ${approvalStatus}` : undefined;
          }
        }
      }

      if (!status) return;

      setLastExecutionByNode((current) => {
        let next = current;
        const now = Date.now();
        for (const ref of refs) {
          const previous = next[ref.nodeId];
          const snapshot: FlowNodeExecutionSnapshot = {
            nodeId: ref.nodeId,
            nodeType: ref.nodeType ?? previous?.nodeType,
            status,
            outputs: previous?.outputs,
            error: error ?? previous?.error,
            updatedAt: now,
          };
          next = {
            ...next,
            [ref.nodeId]: snapshot,
          };
        }
        return next;
      });
      return;
    }

    if (
      event === "MemberRunStarted" ||
      event === "MemberRunCompleted" ||
      event === "MemberRunError"
    ) {
      const nodeId = typeof payload.nodeId === "string" ? payload.nodeId : null;
      if (!nodeId) return;
      const nodeType = typeof payload.nodeType === "string" ? payload.nodeType : undefined;

      hasLiveUpdatesRef.current = true;

      let status: FlowNodeExecutionSnapshot["status"] | null = null;
      let error: string | undefined;

      if (event === "MemberRunStarted") {
        status = "running";
      } else if (event === "MemberRunCompleted") {
        status = "completed";
      } else if (event === "MemberRunError") {
        status = "error";
        const content = payload.content;
        if (typeof content === "string") {
          error = content;
        }
      }

      if (!status) return;

      setLastExecutionByNode((current) => {
        const now = Date.now();
        const previous = current[nodeId];
        const next: FlowNodeExecutionSnapshot = {
          nodeId,
          nodeType: nodeType ?? previous?.nodeType,
          status,
          outputs: previous?.outputs,
          error: error ?? previous?.error,
          updatedAt: now,
        };

        return {
          ...current,
          [nodeId]: next,
        };
      });
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

    hasLiveUpdatesRef.current = true;

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

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    api.getAgentLastExecution(agentId)
      .then((response) => {
        if (cancelled) return;
        if (hasLiveUpdatesRef.current) return;
        const snapshot = response?.lastExecutionByNode;
        if (snapshot && typeof snapshot === "object") {
          setLastExecutionByNode(snapshot as Record<string, FlowNodeExecutionSnapshot>);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Failed to load last agent execution:", error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

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
