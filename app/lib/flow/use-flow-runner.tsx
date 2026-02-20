"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { FlowNode, FlowEdge } from "@/lib/flow";
import { useFlowState, getNodeDefinition } from "@/lib/flow";
import { api } from "@/lib/services/api";
import { processMessageStream } from "@/lib/services/stream-processor";
import { useFlowExecution, type FlowRunPromptInput } from "@/contexts/flow-execution-context";
import { downstreamClosure, upstreamClosure, filterFlowEdges } from "@/lib/flow/graph-traversal";

export type FlowRunMode = "execute" | "runFrom";

interface PromptState {
  open: boolean;
  nodeId: string | null;
  mode: FlowRunMode | null;
  triggerOptions: TriggerOption[];
  selectedTriggerId: string | null;
  requirePromptInput: boolean;
}

interface FlowRunnerContextValue {
  promptState: PromptState;
  isRunning: boolean;
  requestRun: (nodeId: string, mode: FlowRunMode) => void;
  stopRun: () => Promise<void>;
  closePrompt: () => void;
  submitPrompt: (input: FlowRunPromptInput) => Promise<void>;
  getPromptNode: () => FlowNode | null;
  setPromptTriggerId: (triggerId: string) => void;
}

const FlowRunnerContext = createContext<FlowRunnerContextValue | null>(null);

interface TriggerOption {
  id: string;
  label: string;
}

function getNodeDisplayName(node: FlowNode | null): string {
  if (!node) return "Node";
  const label = node.data?._label;
  if (typeof label === "string" && label.trim()) return label;
  const definition = getNodeDefinition(node.type || "");
  return definition?.name ?? node.type ?? "Node";
}

export function buildCachedOutputs(
  executionByNode: Record<string, { outputs?: Record<string, unknown> }>,
  allowedNodeIds: Set<string>
): Record<string, Record<string, unknown>> {
  const cached: Record<string, Record<string, unknown>> = {};
  for (const [nodeId, snapshot] of Object.entries(executionByNode)) {
    if (!allowedNodeIds.has(nodeId)) continue;
    const outputs = snapshot.outputs;
    if (!outputs || Object.keys(outputs).length === 0) continue;
    cached[nodeId] = outputs as Record<string, unknown>;
  }
  return cached;
}

function getCachedNodeIds(
  executionByNode: Record<string, { outputs?: Record<string, unknown> }>
): Set<string> {
  return new Set(
    Object.entries(executionByNode)
      .filter(([, snapshot]) => snapshot.outputs && Object.keys(snapshot.outputs).length > 0)
      .map(([id]) => id)
  );
}

function isTriggerNode(node: FlowNode): boolean {
  const definition = getNodeDefinition(node.type || "");
  return definition?.category === "trigger";
}

function pickPreferredTriggerId(
  nodes: FlowNode[],
  triggerIds: Set<string>
): string | null {
  if (triggerIds.size === 0) return null;
  const chatStart = nodes.find(node => triggerIds.has(node.id) && node.type === "chat-start");
  if (chatStart) return chatStart.id;
  const firstTrigger = nodes.find(node => triggerIds.has(node.id));
  return firstTrigger ? firstTrigger.id : null;
}

function selectPreferredTrigger(
  nodes: FlowNode[],
  candidateIds: Set<string>
): { preferredId: string | null; excludedIds: Set<string> } {
  if (candidateIds.size <= 1) {
    const onlyId = candidateIds.values().next().value ?? null;
    return { preferredId: onlyId, excludedIds: new Set() };
  }

  const preferredId = pickPreferredTriggerId(nodes, candidateIds);
  const excludedIds = new Set<string>();
  for (const id of candidateIds) {
    if (!preferredId || id !== preferredId) {
      excludedIds.add(id);
    }
  }
  return { preferredId: preferredId ?? null, excludedIds };
}

interface RunPlan {
  nodesToRun: Set<string>;
  cachedNodeIds: Set<string>;
  excludedTriggerIds: Set<string>;
  usesTrigger: boolean;
  triggerCandidates: Set<string>;
  selectedTriggerId: string | null;
}

export function computeRunPlan(
  mode: FlowRunMode,
  nodeId: string,
  nodes: FlowNode[],
  edges: FlowEdge[],
  pinnedSet: Set<string>,
  executionByNode: Record<string, { outputs?: Record<string, unknown> }>,
  selectedTriggerId?: string | null
): RunPlan {
  const cachedSet = getCachedNodeIds(executionByNode);
  const dependencyScope = upstreamClosure([nodeId], edges, {
    stopAt: pinnedSet,
    includeStopNodes: true,
  });
  dependencyScope.add(nodeId);

  const triggerCandidates = new Set(
    nodes
      .filter((node) => dependencyScope.has(node.id) && isTriggerNode(node))
      .map((node) => node.id)
  );
  let effectiveTriggerId: string | null = null;
  if (selectedTriggerId && triggerCandidates.has(selectedTriggerId)) {
    effectiveTriggerId = selectedTriggerId;
  } else if (triggerCandidates.size > 0) {
    effectiveTriggerId = pickPreferredTriggerId(nodes, triggerCandidates);
  }

  const { excludedIds: excludedTriggerIds } = selectPreferredTrigger(
    nodes,
    triggerCandidates
  );
  if (effectiveTriggerId) {
    excludedTriggerIds.delete(effectiveTriggerId);
  }

  if (mode === "runFrom") {
    const nodesToRun = computeRunFromNodes(nodeId, edges, pinnedSet);
    const cachedNodeIds = new Set(
      [...cachedSet].filter(
        (id) => dependencyScope.has(id) && !excludedTriggerIds.has(id)
      )
    );
    const usesTrigger = nodes.some(
      (node) => nodesToRun.has(node.id) && isTriggerNode(node)
    );
    return {
      nodesToRun,
      cachedNodeIds,
      excludedTriggerIds,
      usesTrigger,
      triggerCandidates,
      selectedTriggerId: effectiveTriggerId,
    };
  }

  const stopSet = new Set([...pinnedSet, ...cachedSet]);
  if (stopSet.has(nodeId) && !pinnedSet.has(nodeId)) {
    stopSet.delete(nodeId);
  }

  const nodesToRun = upstreamClosure([nodeId], edges, { stopAt: stopSet });
  nodesToRun.add(nodeId);

  for (const excludedId of excludedTriggerIds) {
    nodesToRun.delete(excludedId);
  }

  const cachedNodeIds = new Set(
    [...cachedSet].filter(
      (id) =>
        dependencyScope.has(id) &&
        !nodesToRun.has(id) &&
        !excludedTriggerIds.has(id)
    )
  );

  const usesTrigger = nodes.some(
    (node) => nodesToRun.has(node.id) && isTriggerNode(node)
  );

  return {
    nodesToRun,
    cachedNodeIds,
    excludedTriggerIds,
    usesTrigger,
    triggerCandidates,
    selectedTriggerId: effectiveTriggerId,
  };
}

export function computeExecuteNodes(
  nodeId: string,
  nodes: FlowNode[],
  edges: FlowEdge[],
  pinnedSet: Set<string>,
  executionByNode: Record<string, { outputs?: Record<string, unknown> }>
): Set<string> {
  return computeRunPlan(
    "execute",
    nodeId,
    nodes,
    edges,
    pinnedSet,
    executionByNode
  ).nodesToRun;
}

export function computeRunFromNodes(
  nodeId: string,
  edges: FlowEdge[],
  pinnedSet: Set<string>
): Set<string> {
  const closure = downstreamClosure([nodeId], edges);
  for (const pinned of pinnedSet) {
    if (closure.has(pinned)) closure.delete(pinned);
  }
  return closure;
}

export function FlowRunnerProvider({ children, agentId }: { children: ReactNode; agentId: string }) {
  const { nodes, edges } = useFlowState();
  const flowEdges = useMemo(() => filterFlowEdges(edges), [edges]);
  const [promptState, setPromptState] = useState<PromptState>({
    open: false,
    nodeId: null,
    mode: null,
    triggerOptions: [],
    selectedTriggerId: null,
    requirePromptInput: true,
  });
  const [isRunning, setIsRunning] = useState(false);
  const streamAbortRef = useRef<(() => void) | null>(null);
  const runIdRef = useRef<string | null>(null);
  const stopRequestedRef = useRef(false);
  const {
    executionByNode,
    pinnedByNodeId,
    lastPromptInput,
    recordFlowEvent,
    setLastPromptInput,
    clearExecutionForNodes,
    clearRunningExecution,
  } = useFlowExecution();

  const runWithInput = useCallback(
    async (
      nodeId: string,
      mode: FlowRunMode,
      input: FlowRunPromptInput,
      selectedTriggerId?: string | null
    ) => {
      stopRequestedRef.current = false;
      runIdRef.current = null;

      const pinnedSet = new Set(
        Object.keys(pinnedByNodeId).filter(id => pinnedByNodeId[id])
      );
      const plan = computeRunPlan(
        mode,
        nodeId,
        nodes,
        flowEdges,
        pinnedSet,
        executionByNode,
        selectedTriggerId
      );
      const nodesToRun = plan.nodesToRun;
      const cachedOutputs = buildCachedOutputs(executionByNode, plan.cachedNodeIds);
      const nodeIds = Array.from(nodesToRun);

      const downstreamToClear =
        mode === "execute"
          ? downstreamClosure([nodeId], flowEdges, { stopAt: pinnedSet })
          : new Set<string>();
      const nodesToClear = new Set([
        ...nodesToRun,
        ...downstreamToClear,
        ...plan.excludedTriggerIds,
      ]);
      clearExecutionForNodes(nodesToClear);

      setLastPromptInput(input);
      setIsRunning(true);

      try {
        const { response, abort } = api.streamFlowRun({
          agentId,
          mode,
          targetNodeId: nodeId,
          cachedOutputs,
          promptInput: { ...input },
          nodeIds,
        });
        streamAbortRef.current = abort;
        if (!response.ok) {
          throw new Error(`Flow run failed: ${response.statusText}`);
        }

        await processMessageStream(response, {
          onUpdate: () => {},
          onMessageId: () => {},
          onSessionId: (sessionId) => {
            runIdRef.current = sessionId;
            if (stopRequestedRef.current) {
              api.cancelFlowRun(sessionId)
                .catch((error) => {
                  console.error("Flow run cancel error:", error);
                })
                .finally(() => {
                  streamAbortRef.current?.();
                  streamAbortRef.current = null;
                });
            }
          },
          onEvent: (eventType, payload) => {
            if (stopRequestedRef.current) return;
            recordFlowEvent(eventType, payload);
          },
        });
      } catch (error) {
        if (!stopRequestedRef.current) {
          console.error("Flow run error:", error);
        }
      } finally {
        setIsRunning(false);
        if (stopRequestedRef.current) {
          clearRunningExecution();
        }
        streamAbortRef.current = null;
        runIdRef.current = null;
        stopRequestedRef.current = false;
        setPromptState({
          open: false,
          nodeId: null,
          mode: null,
          triggerOptions: [],
          selectedTriggerId: null,
          requirePromptInput: true,
        });
      }
    },
    [
      agentId,
      clearExecutionForNodes,
      clearRunningExecution,
      executionByNode,
      flowEdges,
      nodes,
      pinnedByNodeId,
      recordFlowEvent,
      setLastPromptInput,
    ]
  );

  const stopRun = useCallback(async () => {
    if (!isRunning) return;
    stopRequestedRef.current = true;
    clearRunningExecution();
    setIsRunning(false);

    const runId = runIdRef.current;
    if (runId) {
      try {
        await api.cancelFlowRun(runId);
      } catch (error) {
        console.error("Flow run cancel error:", error);
      }
      streamAbortRef.current?.();
      streamAbortRef.current = null;
    }
  }, [clearRunningExecution, isRunning]);

  const requestRun = useCallback(
    (nodeId: string, mode: FlowRunMode) => {
      if (isRunning) return;

      const pinnedSet = new Set(
        Object.keys(pinnedByNodeId).filter(id => pinnedByNodeId[id])
      );
      const plan = computeRunPlan(
        mode,
        nodeId,
        nodes,
        flowEdges,
        pinnedSet,
        executionByNode
      );

      const triggerOptions: TriggerOption[] = Array.from(plan.triggerCandidates).map(
        (triggerId) => {
          const triggerNode = nodes.find(node => node.id === triggerId);
          return {
            id: triggerId,
            label: getNodeDisplayName(triggerNode ?? null),
          };
        }
      );
      const requireTriggerSelection = triggerOptions.length > 1;
      const requirePromptInput = plan.usesTrigger;

      if (!lastPromptInput || requirePromptInput || requireTriggerSelection) {
        setPromptState({
          open: true,
          nodeId,
          mode,
          triggerOptions,
          selectedTriggerId: plan.selectedTriggerId,
          requirePromptInput,
        });
        return;
      }

      runWithInput(nodeId, mode, lastPromptInput, plan.selectedTriggerId);
    },
    [
      executionByNode,
      flowEdges,
      isRunning,
      lastPromptInput,
      nodes,
      pinnedByNodeId,
      runWithInput,
    ]
  );

  const closePrompt = useCallback(() => {
    setPromptState({
      open: false,
      nodeId: null,
      mode: null,
      triggerOptions: [],
      selectedTriggerId: null,
      requirePromptInput: true,
    });
  }, []);

  const setPromptTriggerId = useCallback((triggerId: string) => {
    setPromptState((current) => ({
      ...current,
      selectedTriggerId: triggerId,
    }));
  }, []);

  const getPromptNode = useCallback(() => {
    if (!promptState.nodeId) return null;
    return nodes.find(node => node.id === promptState.nodeId) ?? null;
  }, [nodes, promptState.nodeId]);

  const submitPrompt = useCallback(
    async (input: FlowRunPromptInput) => {
      if (!promptState.nodeId || !promptState.mode) return;
      await runWithInput(
        promptState.nodeId,
        promptState.mode,
        input,
        promptState.selectedTriggerId
      );
    },
    [promptState.mode, promptState.nodeId, promptState.selectedTriggerId, runWithInput]
  );

  const value = useMemo<FlowRunnerContextValue>(
    () => ({
      promptState,
      isRunning,
      requestRun,
      stopRun,
      closePrompt,
      submitPrompt,
      getPromptNode,
      setPromptTriggerId,
    }),
    [
      promptState,
      isRunning,
      requestRun,
      stopRun,
      closePrompt,
      submitPrompt,
      getPromptNode,
      setPromptTriggerId,
    ]
  );

  return (
    <FlowRunnerContext.Provider value={value}>
      {children}
    </FlowRunnerContext.Provider>
  );
}

export function useFlowRunner(): FlowRunnerContextValue {
  const context = useContext(FlowRunnerContext);
  if (!context) {
    throw new Error("useFlowRunner must be used within a FlowRunnerProvider");
  }
  return context;
}

export function usePromptDefaults() {
  const { lastPromptInput } = useFlowExecution();
  return useMemo(() => {
    const message = lastPromptInput?.message ?? "";
    const history = lastPromptInput?.history ?? [];
    return { message, history };
  }, [lastPromptInput]);
}

export function getPromptTitle(node: FlowNode | null, mode: FlowRunMode | null): string {
  const name = getNodeDisplayName(node);
  if (mode === "runFrom") return `Run from ${name}`;
  return `Execute ${name}`;
}
