"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useFlowState } from "@/lib/flow";
import type { FlowEdge, FlowNode } from "@/lib/flow";
import type {
  FlowNodeExecutionSnapshot,
  FlowOutputPortSnapshot,
} from "@/contexts/agent-test-chat-context";
import { downstreamClosure, filterFlowEdges } from "@/lib/flow/graph-traversal";

export interface FlowRunPromptInput {
  message: string;
  history?: Record<string, unknown>[];
  messages?: unknown[];
  attachments?: Record<string, unknown>[];
}

interface FlowExecutionContextValue {
  executionByNode: Record<string, FlowNodeExecutionSnapshot>;
  pinnedByNodeId: Record<string, boolean>;
  lastPromptInput: FlowRunPromptInput | null;
  recordFlowEvent: (event: string, payload: Record<string, unknown>) => void;
  clearExecution: () => void;
  clearExecutionForNodes: (nodeIds: Iterable<string>) => void;
  setPinned: (nodeId: string, pinned: boolean) => void;
  togglePinned: (nodeId: string) => void;
  setLastPromptInput: (input: FlowRunPromptInput) => void;
  hydrateExecution: (snapshot: Record<string, FlowNodeExecutionSnapshot>) => void;
}

const FlowExecutionContext = createContext<FlowExecutionContextValue | null>(null);

const STORAGE_VERSION = 1;

function storageKey(agentId: string): string {
  return `flow-execution:${agentId}:v${STORAGE_VERSION}`;
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

function buildNodeSignature(node: FlowNode): string {
  const data = isRecord(node.data) ? node.data : {};
  return JSON.stringify({ type: node.type, data });
}

function buildEdgeSignature(edge: FlowEdge): string {
  return JSON.stringify({
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null,
    channel: edge.data?.channel,
    sourceType: edge.data?.sourceType,
    targetType: edge.data?.targetType,
  });
}

function buildNodeMap(nodes: FlowNode[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const node of nodes) {
    map.set(node.id, buildNodeSignature(node));
  }
  return map;
}

function buildEdgeMap(edges: FlowEdge[]): Map<string, { signature: string; target: string }> {
  const map = new Map<string, { signature: string; target: string }>();
  for (const edge of edges) {
    map.set(edge.id, { signature: buildEdgeSignature(edge), target: edge.target });
  }
  return map;
}

export function FlowExecutionProvider({
  children,
  agentId,
}: {
  children: ReactNode;
  agentId: string;
}) {
  const { nodes, edges } = useFlowState();
  const [executionByNode, setExecutionByNode] = useState<Record<string, FlowNodeExecutionSnapshot>>({});
  const [pinnedByNodeId, setPinnedByNodeId] = useState<Record<string, boolean>>({});
  const [lastPromptInput, setLastPromptInputState] = useState<FlowRunPromptInput | null>(null);
  const hydratedRef = useRef(false);

  const flowEdges = useMemo(() => filterFlowEdges(edges), [edges]);

  useEffect(() => {
    if (!agentId || hydratedRef.current) return;
    hydratedRef.current = true;

    try {
      const raw = localStorage.getItem(storageKey(agentId));
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!isRecord(parsed)) return;

      const storedExecution = isRecord(parsed.executionByNode) ? parsed.executionByNode : {};
      const storedPinned = isRecord(parsed.pinnedByNodeId) ? parsed.pinnedByNodeId : {};
      const storedPrompt = parsed.lastPromptInput;

      setExecutionByNode(storedExecution as Record<string, FlowNodeExecutionSnapshot>);
      setPinnedByNodeId(storedPinned as Record<string, boolean>);
      if (storedPrompt && isRecord(storedPrompt) && typeof storedPrompt.message === "string") {
        setLastPromptInputState(storedPrompt as FlowRunPromptInput);
      }
    } catch (error) {
      console.error("Failed to load flow execution cache:", error);
    }
  }, [agentId]);

  useEffect(() => {
    if (!agentId || !hydratedRef.current) return;
    const payload = {
      executionByNode,
      pinnedByNodeId,
      lastPromptInput,
      updatedAt: Date.now(),
    };
    try {
      localStorage.setItem(storageKey(agentId), JSON.stringify(payload));
    } catch (error) {
      console.error("Failed to persist flow execution cache:", error);
    }
  }, [agentId, executionByNode, pinnedByNodeId, lastPromptInput]);

  const nodeSignatureRef = useRef<Map<string, string>>(new Map());
  const edgeSignatureRef = useRef<Map<string, { signature: string; target: string }>>(new Map());

  const hasInitializedGraphRef = useRef(false);

  useEffect(() => {
    if (!nodes.length && !edges.length && !hasInitializedGraphRef.current) {
      nodeSignatureRef.current = new Map();
      edgeSignatureRef.current = new Map();
      return;
    }

    if (nodes.length || edges.length) {
      hasInitializedGraphRef.current = true;
    }

    if (!nodes.length) {
      setExecutionByNode({});
      setPinnedByNodeId({});
      nodeSignatureRef.current = new Map();
      edgeSignatureRef.current = new Map();
      return;
    }

    const currentNodeMap = buildNodeMap(nodes);
    const currentEdgeMap = buildEdgeMap(flowEdges);

    const removedNodes = new Set<string>();
    for (const id of nodeSignatureRef.current.keys()) {
      if (!currentNodeMap.has(id)) removedNodes.add(id);
    }

    const pinnedSet = new Set(Object.keys(pinnedByNodeId).filter(id => pinnedByNodeId[id]));

    const changedNodeIds = new Set<string>();
    for (const [id, signature] of currentNodeMap.entries()) {
      const prev = nodeSignatureRef.current.get(id);
      if (prev && prev !== signature) {
        changedNodeIds.add(id);
      }
    }

    const changedEdgeTargets = new Set<string>();
    for (const [id, entry] of currentEdgeMap.entries()) {
      const prev = edgeSignatureRef.current.get(id);
      if (!prev || prev.signature !== entry.signature) {
        if (entry.target) changedEdgeTargets.add(entry.target);
      }
    }
    for (const [id, entry] of edgeSignatureRef.current.entries()) {
      if (!currentEdgeMap.has(id) && entry.target) {
        changedEdgeTargets.add(entry.target);
      }
    }

    const seeds = new Set<string>();
    for (const id of changedNodeIds) {
      if (!pinnedSet.has(id)) seeds.add(id);
    }
    for (const id of changedEdgeTargets) {
      if (!pinnedSet.has(id)) seeds.add(id);
    }

    const invalidated = seeds.size
      ? downstreamClosure(seeds, flowEdges, { stopAt: pinnedSet })
      : new Set<string>();

    const activeNodeIds = new Set(nodes.map(node => node.id));
    const hasStaleExecution = Object.keys(executionByNode).some(id => !activeNodeIds.has(id));
    const hasStalePinned = Object.keys(pinnedByNodeId).some(id => !activeNodeIds.has(id));

    if (removedNodes.size || invalidated.size || hasStaleExecution || hasStalePinned) {
      setExecutionByNode((current) => {
        const next: Record<string, FlowNodeExecutionSnapshot> = {};
        for (const [id, snapshot] of Object.entries(current)) {
          if (!activeNodeIds.has(id)) continue;
          if (invalidated.has(id)) continue;
          next[id] = snapshot;
        }
        return next;
      });

      if (removedNodes.size || hasStalePinned) {
        setPinnedByNodeId((current) => {
          const next: Record<string, boolean> = {};
          for (const [id, pinned] of Object.entries(current)) {
            if (!activeNodeIds.has(id)) continue;
            if (pinned) next[id] = true;
          }
          return next;
        });
      }
    }

    nodeSignatureRef.current = currentNodeMap;
    edgeSignatureRef.current = currentEdgeMap;
  }, [nodes, edges, flowEdges, pinnedByNodeId, executionByNode]);

  const recordFlowEvent = useCallback((event: string, payload: Record<string, unknown>) => {
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

      setExecutionByNode((current) => {
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

      setExecutionByNode((current) => {
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

    const eventData = parseEventContent(payload.content) ?? payload;
    const nodeId = typeof eventData.nodeId === "string" ? eventData.nodeId : null;
    if (!nodeId) return;

    const nodeType = typeof eventData.nodeType === "string" ? eventData.nodeType : undefined;
    const outputs = parseOutputs(eventData.outputs);
    const error = typeof eventData.error === "string" ? eventData.error : undefined;

    setExecutionByNode((current) => {
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

  const clearExecution = useCallback(() => {
    setExecutionByNode((current) => {
      const next: Record<string, FlowNodeExecutionSnapshot> = {};
      for (const [id, snapshot] of Object.entries(current)) {
        if (pinnedByNodeId[id]) {
          next[id] = snapshot;
        }
      }
      return next;
    });
  }, [pinnedByNodeId]);

  const clearExecutionForNodes = useCallback(
    (nodeIds: Iterable<string>) => {
      const ids = new Set(nodeIds);
      if (ids.size === 0) return;

      setExecutionByNode((current) => {
        let changed = false;
        const next: Record<string, FlowNodeExecutionSnapshot> = {};
        for (const [id, snapshot] of Object.entries(current)) {
          if (ids.has(id) && !pinnedByNodeId[id]) {
            changed = true;
            continue;
          }
          next[id] = snapshot;
        }
        return changed ? next : current;
      });
    },
    [pinnedByNodeId]
  );

  const setPinned = useCallback((nodeId: string, pinned: boolean) => {
    setPinnedByNodeId((current) => {
      const next = { ...current };
      if (pinned) {
        next[nodeId] = true;
      } else {
        delete next[nodeId];
      }
      return next;
    });
  }, []);

  const togglePinned = useCallback((nodeId: string) => {
    setPinnedByNodeId((current) => {
      const next = { ...current };
      if (next[nodeId]) {
        delete next[nodeId];
      } else {
        next[nodeId] = true;
      }
      return next;
    });
  }, []);

  const setLastPromptInput = useCallback((input: FlowRunPromptInput) => {
    setLastPromptInputState(input);
  }, []);

  const hydrateExecution = useCallback((snapshot: Record<string, FlowNodeExecutionSnapshot>) => {
    if (!snapshot || Object.keys(snapshot).length === 0) return;
    setExecutionByNode((current) => ({ ...snapshot, ...current }));
  }, []);

  const value = useMemo<FlowExecutionContextValue>(
    () => ({
      executionByNode,
      pinnedByNodeId,
      lastPromptInput,
      recordFlowEvent,
      clearExecution,
      clearExecutionForNodes,
      setPinned,
      togglePinned,
      setLastPromptInput,
      hydrateExecution,
    }),
    [
      executionByNode,
      pinnedByNodeId,
      lastPromptInput,
      recordFlowEvent,
      clearExecution,
      clearExecutionForNodes,
      setPinned,
      togglePinned,
      setLastPromptInput,
      hydrateExecution,
    ]
  );

  return (
    <FlowExecutionContext.Provider value={value}>
      {children}
    </FlowExecutionContext.Provider>
  );
}

export function useFlowExecution(): FlowExecutionContextValue {
  const context = useContext(FlowExecutionContext);
  if (!context) {
    throw new Error("useFlowExecution must be used within a FlowExecutionProvider");
  }
  return context;
}
