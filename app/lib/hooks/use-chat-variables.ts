"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { VariableSpec } from "@nodes/_variables";
import { getChatVariableSpecs, type GraphData } from "@/python/api";
import type { ResolveOptionsContext } from "@/lib/flow/variable-options";
import { readSpecs } from "@/components/flow/controls/variables-editor/shared";

export interface UseChatVariableSpecsArgs {
  chatId?: string | null;
  modelId?: string | null;
  agentId?: string | null;
  graphData?: GraphData | null;
}

interface ChatVariableSpecsResult {
  specs: VariableSpec[];
  optionsContext: ResolveOptionsContext;
  loading: boolean;
  refetch: () => void;
}

function shouldFetchSpecs(args: UseChatVariableSpecsArgs): boolean {
  if (args.graphData) return true;
  if (args.chatId) return true;
  if (args.agentId) return true;
  if (args.modelId && args.modelId.startsWith("agent:")) return true;
  return false;
}

export function useChatVariableSpecs(
  args: UseChatVariableSpecsArgs,
): ChatVariableSpecsResult {
  const [specs, setSpecs] = useState<VariableSpec[]>([]);
  const [optionsContext, setOptionsContext] = useState<ResolveOptionsContext>({});
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState(0);

  const chatIdKey = args.chatId ?? null;
  const modelIdKey = args.modelId ?? null;
  const agentIdKey = args.agentId ?? null;
  const graphKey = useMemo(() => structuralGraphKey(args.graphData ?? null), [args.graphData]);
  const graphRef = useRef<GraphData | null>(args.graphData ?? null);
  graphRef.current = args.graphData ?? null;

  useEffect(() => {
    const graphData = graphRef.current;
    if (!shouldFetchSpecs({ chatId: chatIdKey, modelId: modelIdKey, agentId: agentIdKey, graphData })) {
      setSpecs([]);
      setOptionsContext({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    getChatVariableSpecs({
      body: {
        chatId: chatIdKey ?? undefined,
        modelId: modelIdKey ?? undefined,
        agentId: agentIdKey ?? undefined,
        graphData: graphData ? { nodes: graphData.nodes, edges: graphData.edges } : undefined,
      },
    })
      .then((response) => {
        if (cancelled) return;
        const list = readSpecs(response.specs);
        const responseGraph = isGraphData(response.graphData)
          ? response.graphData
          : undefined;
        setSpecs(list);
        setOptionsContext({
          graphData: responseGraph,
          chatStartNodeId: response.nodeId ?? null,
        });
      })
      .catch((error: unknown) => {
        console.error("Failed to load chat variable specs", error);
        if (!cancelled) {
          setSpecs([]);
          setOptionsContext({});
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [chatIdKey, modelIdKey, agentIdKey, graphKey, token]);

  return {
    specs,
    optionsContext,
    loading,
    refetch: () => setToken((n) => n + 1),
  };
}

function isGraphData(value: unknown): value is { nodes: unknown[]; edges: unknown[] } {
  if (!value || typeof value !== "object") return false;
  const graph = value as { nodes?: unknown; edges?: unknown };
  return Array.isArray(graph.nodes) && Array.isArray(graph.edges);
}

function structuralGraphKey(graph: GraphData | null): string {
  if (!graph) return "";
  return JSON.stringify({
    nodes: graph.nodes.map((n) => ({ id: n.id, type: n.type, data: n.data })),
    edges: graph.edges.map((e) => ({
      source: e.source,
      sourceHandle: e.sourceHandle,
      target: e.target,
      targetHandle: e.targetHandle,
      data: e.data,
    })),
  });
}
