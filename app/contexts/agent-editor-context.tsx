'use client';

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useState,
  useRef,
  useMemo,
  type ReactNode,
} from 'react';
import { useFlowState, useFlowActions } from '@/lib/flow';
import {
  getAgent,
  updateAgent,
  saveAgentGraph,
  type AgentDetailResponse,
} from '@/python/api';

const AUTOSAVE_DEBOUNCE_MS = 600;
const AUTOSAVE_MAX_WAIT_MS = 4000;

type SaveStatus = 'saved' | 'saving' | 'dirty' | 'error';

function normalizeEdgeData(
  data: unknown
): Record<string, unknown> {
  if (!data || typeof data !== 'object') return { channel: 'flow' };

  const normalized = { ...(data as Record<string, unknown>) };
  const sourceType = typeof normalized.sourceType === 'string' ? normalized.sourceType : undefined;
  const targetType = typeof normalized.targetType === 'string' ? normalized.targetType : undefined;
  const inferredChannel = sourceType === 'tools' || targetType === 'tools' ? 'link' : 'flow';
  normalized.channel = typeof normalized.channel === 'string' ? normalized.channel : inferredChannel;
  return normalized;
}

interface AgentEditorContextValue {
  agentId: string;
  agent: AgentDetailResponse | null;
  isLoading: boolean;
  loadError: string | null;
  saveStatus: SaveStatus;
  lastSaved: Date | null;
  saveError: string | null;
  updateMetadata: (updates: { name?: string; description?: string; icon?: string }) => Promise<void>;
  forceSave: () => Promise<void>;
  reload: () => Promise<void>;
}

const AgentEditorContext = createContext<AgentEditorContextValue | null>(null);

interface AgentEditorProviderProps {
  agentId: string;
  children: ReactNode;
}

export function AgentEditorProvider({ agentId, children }: AgentEditorProviderProps) {
  const { nodes, edges } = useFlowState();
  const { loadGraph } = useFlowActions();

  const [agent, setAgent] = useState<AgentDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaveTimeRef = useRef<number>(0);
  const previousNodesRef = useRef<string>('');
  const previousEdgesRef = useRef<string>('');
  const isInitialLoadRef = useRef(true);
  const isSavingRef = useRef(false);
  const saveGraphRef = useRef<() => Promise<void>>(undefined);
  const loadAgent = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const response = await getAgent({ body: { id: agentId } });
      setAgent(response);
      const graphNodes = response.graphData.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: { x: n.position.x, y: n.position.y },
        data: n.data,
      }));
      const graphEdges = response.graphData.edges.map((e) => ({
        id: e.id,
        source: e.source,
        sourceHandle: e.sourceHandle ?? '',
        target: e.target,
        targetHandle: e.targetHandle ?? '',
        data: normalizeEdgeData(e.data),
      }));

      loadGraph(graphNodes, graphEdges, { skipHistory: true });

      previousNodesRef.current = JSON.stringify(
        graphNodes.map((n) => ({
          id: n.id,
          type: n.type || 'unknown',
          position: n.position,
          data: n.data || {},
        }))
      );
      previousEdgesRef.current = JSON.stringify(
        graphEdges.map((e) => ({
          id: e.id,
          source: e.source,
          sourceHandle: e.sourceHandle || undefined,
          target: e.target,
          targetHandle: e.targetHandle || undefined,
          data: normalizeEdgeData(e.data),
        }))
      );
      lastSaveTimeRef.current = Date.now();
      isInitialLoadRef.current = false;

      setLastSaved(new Date(response.updatedAt));
    } catch (err) {
      console.error('Failed to load agent:', err);
      setLoadError('Failed to load agent');
    } finally {
      setIsLoading(false);
    }
  }, [agentId, loadGraph]);

  useEffect(() => {
    loadAgent();
  }, [loadAgent]);

  const serializeNodes = useCallback(
    () =>
      JSON.stringify(
        nodes.map((n) => ({
          id: n.id,
          type: n.type || 'unknown',
          position: n.position,
          data: (n.data as Record<string, unknown>) || {},
        }))
      ),
    [nodes]
  );

  const serializeEdges = useCallback(
    () =>
      JSON.stringify(
        edges.map((e) => ({
          id: e.id,
          source: e.source,
          sourceHandle: e.sourceHandle || undefined,
          target: e.target,
          targetHandle: e.targetHandle || undefined,
          data: normalizeEdgeData(e.data),
        }))
      ),
    [edges]
  );

  const saveGraph = useCallback(async () => {
    if (isSavingRef.current || isInitialLoadRef.current) return;

    isSavingRef.current = true;
    setSaveStatus('saving');
    setSaveError(null);

    try {
      const apiNodes = nodes.map((n) => ({
        id: n.id,
        type: n.type || 'unknown',
        position: n.position,
        data: (n.data as Record<string, unknown>) || {},
      }));
      const apiEdges = edges.map((e) => ({
        id: e.id,
        source: e.source,
        sourceHandle: e.sourceHandle || undefined,
        target: e.target,
        targetHandle: e.targetHandle || undefined,
        data: normalizeEdgeData(e.data),
      }));

      await saveAgentGraph({
        body: {
          id: agentId,
          nodes: apiNodes,
          edges: apiEdges,
        },
      });

      previousNodesRef.current = serializeNodes();
      previousEdgesRef.current = serializeEdges();
      lastSaveTimeRef.current = Date.now();
      setLastSaved(new Date());
      setSaveStatus('saved');
    } catch (err) {
      console.error('Failed to save graph:', err);
      setSaveError('Failed to save');
      setSaveStatus('error');
    } finally {
      isSavingRef.current = false;
    }
  }, [agentId, nodes, edges, serializeNodes, serializeEdges]);

  saveGraphRef.current = saveGraph;

  useEffect(() => {
    if (isInitialLoadRef.current || isLoading) return;

    const currentNodes = serializeNodes();
    const currentEdges = serializeEdges();
    const hasChanges =
      currentNodes !== previousNodesRef.current ||
      currentEdges !== previousEdgesRef.current;

    if (!hasChanges) return;

    setSaveStatus('dirty');

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    const now = Date.now();
    const timeSinceLastSave = now - lastSaveTimeRef.current;

    if (timeSinceLastSave >= AUTOSAVE_MAX_WAIT_MS) {
      saveGraphRef.current?.();
      return;
    }

    debounceTimerRef.current = setTimeout(() => {
      saveGraphRef.current?.();
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [serializeNodes, serializeEdges, isLoading]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        saveGraphRef.current?.();
      }
    };
  }, []);

  const updateMetadata = useCallback(
    async (updates: { name?: string; description?: string; icon?: string }) => {
      if (!agent) return;

      try {
        await updateAgent({
          body: {
            id: agentId,
            ...updates,
          },
        });

        setAgent((prev) =>
          prev
            ? {
                ...prev,
                name: updates.name ?? prev.name,
                description: updates.description ?? prev.description,
                icon: updates.icon ?? prev.icon,
              }
            : null
        );
      } catch (err) {
        console.error('Failed to update agent metadata:', err);
        throw err;
      }
    },
    [agentId, agent]
  );

  const forceSave = useCallback(async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    await saveGraph();
  }, [saveGraph]);

  const value = useMemo<AgentEditorContextValue>(
    () => ({
      agentId,
      agent,
      isLoading,
      loadError,
      saveStatus,
      lastSaved,
      saveError,
      updateMetadata,
      forceSave,
      reload: loadAgent,
    }),
    [
      agentId,
      agent,
      isLoading,
      loadError,
      saveStatus,
      lastSaved,
      saveError,
      updateMetadata,
      forceSave,
      loadAgent,
    ]
  );

  return (
    <AgentEditorContext.Provider value={value}>
      {children}
    </AgentEditorContext.Provider>
  );
}

export function useAgentEditor(): AgentEditorContextValue {
  const context = useContext(AgentEditorContext);
  if (!context) {
    throw new Error('useAgentEditor must be used within an AgentEditorProvider');
  }
  return context;
}
