'use client';

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from 'react';
import {
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Edge,
  type Node,
  type OnNodesChange,
  type OnEdgesChange,
} from '@xyflow/react';

import type { EdgeChannel, FlowNode, FlowEdge, NodeDefinition, Parameter, SocketTypeId } from '@nodes/_types';
import { getNodeDefinition } from '@nodes/_registry';
import { canConnect, canCoerce } from './sockets';
import { resolveParameterForHandle } from './node-parameters';

function getSocketTypeFromParam(param: Parameter): SocketTypeId {
  if (param.socket?.type) return param.socket.type;
  if (param.type === 'tools') return 'tools';
  return 'data';
}

function getEdgeChannel(
  sourceParam: Parameter | undefined,
  targetParam: Parameter | undefined,
  sourceType: SocketTypeId,
  targetType: SocketTypeId
): EdgeChannel {
  const explicitChannel = sourceParam?.socket?.channel ?? targetParam?.socket?.channel;
  if (explicitChannel) return explicitChannel;
  if (sourceType === 'tools' || targetType === 'tools') return 'link';
  return 'flow';
}

function getSocketTypeForHandle(
  nodes: Node[],
  nodeId: string,
  handleId: string | null | undefined,
  isSource: boolean
): SocketTypeId {
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return isSource ? 'data' : 'tools';

  if (node.type === 'reroute') {
    const socketType = (node.data as { _socketType?: unknown } | undefined)?._socketType;
    if (typeof socketType === 'string' && socketType) {
      return socketType as SocketTypeId;
    }
  }

  const definition = getNodeDefinition(node.type || '');
  if (!definition) return isSource ? 'data' : 'tools';

  const param = resolveParameterForHandle(definition, handleId);
  if (!param) return isSource ? 'data' : 'tools';

  return getSocketTypeFromParam(param);
}

function getParameterForHandle(
  nodes: Node[],
  nodeId: string,
  handleId: string | null | undefined
): Parameter | undefined {
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return undefined;

  const definition = getNodeDefinition(node.type || '');
  if (!definition) return undefined;

  return resolveParameterForHandle(definition, handleId);
}

function canHandleActAsSource(param: Parameter | undefined): boolean {
  if (!param?.socket) return false;
  return param.mode === 'output' || Boolean(param.socket.bidirectional);
}

function canHandleActAsTarget(param: Parameter | undefined): boolean {
  if (!param?.socket) return false;
  return param.mode !== 'output' || Boolean(param.socket.bidirectional);
}

function normalizeConnectionDirection(
  connection: Connection | Edge,
  nodes: Node[]
): Connection | Edge {
  const sourceParam = getParameterForHandle(
    nodes,
    connection.source || '',
    connection.sourceHandle
  );
  const targetParam = getParameterForHandle(
    nodes,
    connection.target || '',
    connection.targetHandle
  );

  if (!sourceParam || !targetParam) {
    return connection;
  }

  if (canHandleActAsSource(sourceParam) && canHandleActAsTarget(targetParam)) {
    return connection;
  }

  if (canHandleActAsSource(targetParam) && canHandleActAsTarget(sourceParam)) {
    return {
      ...connection,
      source: connection.target,
      sourceHandle: connection.targetHandle,
      target: connection.source,
      targetHandle: connection.sourceHandle,
    } as typeof connection;
  }

  return connection;
}

function countEdgesFrom(
  edges: Edge[],
  source: string,
  handle: string | null | undefined
): number {
  return edges.filter(e => e.source === source && e.sourceHandle === handle).length;
}

function enrichEdgeWithSocketTypes(edge: FlowEdge, nodes: Node[]): FlowEdge {
  const sourceType = getSocketTypeForHandle(nodes, edge.source, edge.sourceHandle, true);
  const targetType = getSocketTypeForHandle(nodes, edge.target, edge.targetHandle, false);
  const channel = edge.data?.channel;
  if (channel !== 'flow' && channel !== 'link') {
    throw new Error(`Edge '${edge.id}' is missing a valid channel`);
  }

  return {
    ...edge,
    type: 'gradient',
    data: { ...edge.data, sourceType, targetType, channel },
  };
}

function generateNodeId(type: string): string {
  return `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function generateEdgeId(source: string, target: string): string {
  return `e-${source}-${target}-${Date.now()}`;
}

function buildNodeData(definition: NodeDefinition, type: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const param of definition.parameters) {
    if ('default' in param && param.default !== undefined) {
      data[param.id] = param.default;
    }
  }

  if (type === 'webhook-trigger') {
    const hookId = typeof data.hookId === 'string' ? data.hookId.trim() : '';
    if (!hookId) {
      data.hookId = `hook_${Math.random().toString(36).slice(2, 10)}`;
    }
  }

  data._label = definition.name;
  return data;
}

interface HistoryEntry {
  nodes: Node[];
  edges: Edge[];
}

interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

const MAX_HISTORY = 50;

function cloneState(nodes: Node[], edges: Edge[]): HistoryEntry {
  return {
    nodes: JSON.parse(JSON.stringify(nodes)),
    edges: JSON.parse(JSON.stringify(edges)),
  };
}

interface SelectionValue {
  selectedNodeId: string | null;
  selectNode: (id: string | null) => void;
}

interface NodePickerState {
  active: boolean;
  originNodeId: string | null;
  paramId: string | null;
  allowedNodeTypes: string[] | null;
  allowSelf: boolean;
}

interface NodePickerStartOptions {
  originNodeId: string;
  paramId: string;
  allowedNodeTypes?: string[] | null;
  allowSelf?: boolean;
}

interface NodePickerValue extends NodePickerState {
  startPick: (options: NodePickerStartOptions) => void;
  cancelPick: () => void;
  completePick: () => void;
  isPickableNode: (nodeId: string, nodeType?: string | null) => boolean;
}

interface FlowStateValue {
  nodes: FlowNode[];
  edges: FlowEdge[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  canUndo: boolean;
  canRedo: boolean;
}

interface FlowActionsValue {
  onConnect: (connection: Connection, socketTypes?: { sourceType: SocketTypeId; targetType: SocketTypeId }) => void;
  isValidConnection: (connection: Connection | Edge) => boolean;
  addNode: (type: string, position: { x: number; y: number }) => string;
  removeNode: (id: string) => void;
  insertRerouteOnEdge: (edgeId: string, position: { x: number; y: number }) => string | null;
  updateNodeData: (nodeId: string, paramId: string, value: unknown) => void;
  updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  loadGraph: (nodes: FlowNode[], edges: FlowEdge[], options?: { skipHistory?: boolean }) => void;
  clearGraph: (options?: { skipHistory?: boolean }) => void;
  getNode: (id: string) => FlowNode | undefined;
  getConnectedInputs: (nodeId: string) => Set<string>;
  undo: () => void;
  redo: () => void;
  recordDragEnd: () => void;
}

type FlowContextValue = FlowStateValue & FlowActionsValue & SelectionValue;

const SelectionContext = createContext<SelectionValue | null>(null);
const FlowStateContext = createContext<FlowStateValue | null>(null);
const FlowActionsContext = createContext<FlowActionsValue | null>(null);
const NodePickerContext = createContext<NodePickerValue | null>(null);

export function FlowProvider({ children }: { children: ReactNode }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [pickerState, setPickerState] = useState<NodePickerState>({
    active: false,
    originNodeId: null,
    paramId: null,
    allowedNodeTypes: null,
    allowSelf: false,
  });

  const historyRef = useRef<HistoryState>({ past: [], future: [] });
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const isRestoringRef = useRef(false);

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  const updateHistoryState = useCallback(() => {
    setCanUndo(historyRef.current.past.length > 0);
    setCanRedo(historyRef.current.future.length > 0);
  }, []);

  const pushHistory = useCallback(() => {
    if (isRestoringRef.current) return;

    const entry = cloneState(nodesRef.current, edgesRef.current);
    const { past } = historyRef.current;

    historyRef.current = {
      past: [...past.slice(-(MAX_HISTORY - 1)), entry],
      future: [],
    };

    updateHistoryState();
  }, [updateHistoryState]);

  const DEBOUNCE_MS = 300;
  const MAX_WAIT_MS = 2000;
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSnapshotRef = useRef<number>(0);

  const pushHistoryDebounced = useCallback(() => {
    if (isRestoringRef.current) return;

    const now = Date.now();
    const timeSinceLastSnapshot = now - lastSnapshotRef.current;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (timeSinceLastSnapshot >= MAX_WAIT_MS) {
      pushHistory();
      lastSnapshotRef.current = now;
      return;
    }

    debounceTimerRef.current = setTimeout(() => {
      pushHistory();
      lastSnapshotRef.current = Date.now();
      debounceTimerRef.current = null;
    }, DEBOUNCE_MS);
  }, [pushHistory]);

  const flushDebounce = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  useEffect(() => flushDebounce, [flushDebounce]);

  const undo = useCallback(() => {
    flushDebounce();
    const { past, future } = historyRef.current;
    if (past.length === 0) return;

    const current = cloneState(nodesRef.current, edgesRef.current);
    const previous = past[past.length - 1];

    historyRef.current = {
      past: past.slice(0, -1),
      future: [current, ...future],
    };

    isRestoringRef.current = true;
    setNodes(previous.nodes);
    setEdges(previous.edges);
    setSelectedNodeId(null);
    updateHistoryState();

    requestAnimationFrame(() => {
      isRestoringRef.current = false;
    });
  }, [setNodes, setEdges, updateHistoryState, flushDebounce]);

  const redo = useCallback(() => {
    flushDebounce();
    const { past, future } = historyRef.current;
    if (future.length === 0) return;

    const current = cloneState(nodesRef.current, edgesRef.current);
    const next = future[0];

    historyRef.current = {
      past: [...past, current],
      future: future.slice(1),
    };

    isRestoringRef.current = true;
    setNodes(next.nodes);
    setEdges(next.edges);
    setSelectedNodeId(null);
    updateHistoryState();

    requestAnimationFrame(() => {
      isRestoringRef.current = false;
    });
  }, [setNodes, setEdges, updateHistoryState, flushDebounce]);

  const recordDragEnd = useCallback(() => {
    pushHistory();
  }, [pushHistory]);

  const selectNode = useCallback((id: string | null) => {
    setSelectedNodeId(id);
  }, []);

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const normalized = normalizeConnectionDirection(connection, nodesRef.current);

      const sourceNode = nodesRef.current.find(n => n.id === normalized.source);
      const targetNode = nodesRef.current.find(n => n.id === normalized.target);

      const sourceType = getSocketTypeForHandle(
        nodesRef.current,
        normalized.source || '',
        normalized.sourceHandle,
        true
      );
      const sourceParam = getParameterForHandle(
        nodesRef.current,
        normalized.source || '',
        normalized.sourceHandle
      );
      const targetParam = getParameterForHandle(
        nodesRef.current,
        normalized.target || '',
        normalized.targetHandle
      );

      if (!sourceParam || !targetParam) return false;

      const sourceRerouteType = (sourceNode?.data as { _socketType?: unknown } | undefined)?._socketType;
      const targetRerouteType = (targetNode?.data as { _socketType?: unknown } | undefined)?._socketType;

      if (
        sourceNode?.type === 'reroute' &&
        normalized.sourceHandle === 'output' &&
        (typeof sourceRerouteType !== 'string' || !sourceRerouteType)
      ) {
        return true;
      }

      if (
        targetNode?.type === 'reroute' &&
        normalized.targetHandle === 'input' &&
        typeof targetRerouteType === 'string' &&
        targetRerouteType
      ) {
        return canCoerce(sourceType, targetRerouteType as SocketTypeId);
      }

      return canConnect(sourceType, targetParam);
    },
    []
  );

  const onConnect = useCallback(
    (connection: Connection, socketTypes?: { sourceType: SocketTypeId; targetType: SocketTypeId }) => {
      const normalized = normalizeConnectionDirection(connection, nodesRef.current) as Connection;
      pushHistory();

      let sourceType = socketTypes?.sourceType ?? getSocketTypeForHandle(
        nodesRef.current,
        normalized.source || '',
        normalized.sourceHandle,
        true
      );
      let targetType = socketTypes?.targetType ?? getSocketTypeForHandle(
        nodesRef.current,
        normalized.target || '',
        normalized.targetHandle,
        false
      );

      const sourceParam = getParameterForHandle(
        nodesRef.current,
        normalized.source || '',
        normalized.sourceHandle
      );
      const targetParam = getParameterForHandle(
        nodesRef.current,
        normalized.target || '',
        normalized.targetHandle
      );

      const updateRerouteSocketType = (nodeId: string, socketType: SocketTypeId) => {
        setNodes(nds =>
          nds.map(node => {
            if (node.id !== nodeId) return node;
            const current = (node.data as { _socketType?: unknown } | undefined)?._socketType;
            if (current === socketType) return node;
            return { ...node, data: { ...node.data, _socketType: socketType } };
          })
        );
      };

      const sourceNode = nodesRef.current.find(node => node.id === normalized.source);
      const targetNode = nodesRef.current.find(node => node.id === normalized.target);

      const sourceRerouteType = (sourceNode?.data as { _socketType?: unknown } | undefined)?._socketType;
      const targetRerouteType = (targetNode?.data as { _socketType?: unknown } | undefined)?._socketType;

      if (normalized.source && normalized.sourceHandle === 'output') {
        if (
          sourceNode?.type === 'reroute' &&
          (typeof sourceRerouteType !== 'string' || !sourceRerouteType)
        ) {
          sourceType = targetType;
          updateRerouteSocketType(normalized.source, sourceType);
        }
      }

      if (normalized.target && normalized.targetHandle === 'input') {
        if (
          targetNode?.type === 'reroute' &&
          (typeof targetRerouteType !== 'string' || !targetRerouteType)
        ) {
          targetType = sourceType;
          updateRerouteSocketType(normalized.target, targetType);
        }
      }

      const channel = getEdgeChannel(sourceParam, targetParam, sourceType, targetType);

      const edge: Edge = {
        ...normalized,
        id: generateEdgeId(normalized.source || '', normalized.target || ''),
        type: 'gradient',
        data: { sourceType, targetType, channel },
      };

      setEdges(currentEdges => {
        const currentCount = countEdgesFrom(
          currentEdges,
          normalized.source || '',
          normalized.sourceHandle
        );

        if (!sourceParam?.maxConnections || currentCount < sourceParam.maxConnections) {
          return addEdge(edge, currentEdges);
        }

        if (sourceParam.onExceedMax === 'replace') {
          const filtered = currentEdges.filter(
            e => !(e.source === normalized.source && e.sourceHandle === normalized.sourceHandle)
          );
          return addEdge(edge, filtered);
        }

        return currentEdges;
      });
    },
    [setEdges, setNodes, pushHistory]
  );

  const addNode = useCallback(
    (type: string, position: { x: number; y: number }): string => {
      pushHistory();

      const definition = getNodeDefinition(type);
      if (!definition) {
        throw new Error(`Unknown node type: ${type}`);
      }

      const data = buildNodeData(definition, type);
      const id = generateNodeId(type);
      const node: Node = { id, type, position, data };

      setNodes(nds => [...nds, node]);
      return id;
    },
    [setNodes, pushHistory]
  );

  const removeNode = useCallback(
    (id: string) => {
      pushHistory();

      setNodes(nds => nds.filter(n => n.id !== id));
      setEdges(eds => eds.filter(e => e.source !== id && e.target !== id));

      if (selectedNodeId === id) {
        setSelectedNodeId(null);
      }
    },
    [setNodes, setEdges, selectedNodeId, pushHistory]
  );

  const insertRerouteOnEdge = useCallback(
    (edgeId: string, position: { x: number; y: number }): string | null => {
      const edge = edgesRef.current.find(e => e.id === edgeId);
      if (!edge) return null;

      const definition = getNodeDefinition('reroute');
      if (!definition) return null;

      pushHistory();

      const sourceType =
        (edge.data as { sourceType?: SocketTypeId } | undefined)?.sourceType ??
        getSocketTypeForHandle(nodesRef.current, edge.source, edge.sourceHandle, true);
      const targetType =
        (edge.data as { targetType?: SocketTypeId } | undefined)?.targetType ??
        getSocketTypeForHandle(nodesRef.current, edge.target, edge.targetHandle, false);

      const sourceParam = getParameterForHandle(nodesRef.current, edge.source, edge.sourceHandle);
      const targetParam = getParameterForHandle(nodesRef.current, edge.target, edge.targetHandle);
      const channel =
        (edge.data as { channel?: EdgeChannel } | undefined)?.channel ??
        getEdgeChannel(sourceParam, targetParam, sourceType, targetType);

      const rerouteId = generateNodeId('reroute');
      const rerouteData = buildNodeData(definition, 'reroute');
      rerouteData._socketType = sourceType;

      const node: Node = {
        id: rerouteId,
        type: 'reroute',
        position,
        data: rerouteData,
      };

      const sourceHandle = edge.sourceHandle ?? 'output';
      const targetHandle = edge.targetHandle ?? 'input';

      const inboundEdge: Edge = {
        id: generateEdgeId(edge.source, rerouteId),
        source: edge.source,
        sourceHandle,
        target: rerouteId,
        targetHandle: 'input',
        type: 'gradient',
        data: { sourceType, targetType: sourceType, channel },
      };

      const outboundEdge: Edge = {
        id: generateEdgeId(rerouteId, edge.target),
        source: rerouteId,
        sourceHandle: 'output',
        target: edge.target,
        targetHandle,
        type: 'gradient',
        data: { sourceType, targetType, channel },
      };

      setNodes(nds => [...nds, node]);
      setEdges(eds => {
        const filtered = eds.filter(existing => existing.id !== edgeId);
        return [...filtered, inboundEdge, outboundEdge];
      });

      return rerouteId;
    },
    [pushHistory, setEdges, setNodes]
  );

  const updateNodeData = useCallback(
    (nodeId: string, paramId: string, value: unknown) => {
      pushHistoryDebounced();

      setNodes(nds =>
        nds.map(node =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, [paramId]: value } }
            : node
        )
      );
    },
    [setNodes, pushHistoryDebounced]
  );

  const startPick = useCallback((options: NodePickerStartOptions) => {
    setPickerState({
      active: true,
      originNodeId: options.originNodeId,
      paramId: options.paramId,
      allowedNodeTypes: options.allowedNodeTypes?.length ? [...options.allowedNodeTypes] : null,
      allowSelf: options.allowSelf ?? false,
    });
  }, []);

  const cancelPick = useCallback(() => {
    setPickerState((prev) =>
      prev.active
        ? {
            active: false,
            originNodeId: null,
            paramId: null,
            allowedNodeTypes: null,
            allowSelf: false,
          }
        : prev
    );
  }, []);

  const completePick = useCallback(() => {
    setPickerState((prev) =>
      prev.active
        ? {
            active: false,
            originNodeId: null,
            paramId: null,
            allowedNodeTypes: null,
            allowSelf: false,
          }
        : prev
    );
  }, []);

  const isPickableNode = useCallback(
    (nodeId: string, nodeType?: string | null) => {
      if (!pickerState.active) return false;
      if (!pickerState.allowSelf && pickerState.originNodeId === nodeId) return false;
      if (pickerState.allowedNodeTypes && nodeType) {
        return pickerState.allowedNodeTypes.includes(nodeType);
      }
      if (pickerState.allowedNodeTypes && !nodeType) return false;
      return true;
    },
    [pickerState]
  );

  useEffect(() => {
    if (!pickerState.active || !pickerState.originNodeId) return;
    const exists = nodes.some(node => node.id === pickerState.originNodeId);
    if (!exists) {
      cancelPick();
    }
  }, [cancelPick, nodes, pickerState.active, pickerState.originNodeId]);

  const updateNodePosition = useCallback(
    (nodeId: string, position: { x: number; y: number }) => {
      setNodes(nds =>
        nds.map(node =>
          node.id === nodeId ? { ...node, position } : node
        )
      );
    },
    [setNodes]
  );

  const loadGraph = useCallback(
    (newNodes: FlowNode[], newEdges: FlowEdge[], options?: { skipHistory?: boolean }) => {
      if (!options?.skipHistory) pushHistory();

      const enrichedEdges = newEdges.map(edge =>
        enrichEdgeWithSocketTypes(edge, newNodes as Node[])
      );

      setNodes(newNodes as Node[]);
      setEdges(enrichedEdges as Edge[]);
      setSelectedNodeId(null);
    },
    [setNodes, setEdges, pushHistory]
  );

  const clearGraph = useCallback(
    (options?: { skipHistory?: boolean }) => {
      if (!options?.skipHistory) pushHistory();

      setNodes([]);
      setEdges([]);
      setSelectedNodeId(null);
    },
    [setNodes, setEdges, pushHistory]
  );

  const getNode = useCallback(
    (id: string): FlowNode | undefined => {
      return nodesRef.current.find(n => n.id === id) as FlowNode | undefined;
    },
    []
  );

  const getConnectedInputs = useCallback(
    (nodeId: string): Set<string> => {
      const connected = new Set<string>();
      for (const edge of edgesRef.current) {
        if (edge.target === nodeId && edge.targetHandle) {
          connected.add(edge.targetHandle);
        }
      }
      return connected;
    },
    []
  );

  const selectionValue = useMemo<SelectionValue>(
    () => ({ selectedNodeId, selectNode }),
    [selectedNodeId, selectNode]
  );

  const nodePickerValue = useMemo<NodePickerValue>(
    () => ({
      ...pickerState,
      startPick,
      cancelPick,
      completePick,
      isPickableNode,
    }),
    [pickerState, startPick, cancelPick, completePick, isPickableNode]
  );

  const stateValue = useMemo<FlowStateValue>(
    () => ({
      nodes: nodes as FlowNode[],
      edges: edges as FlowEdge[],
      onNodesChange,
      onEdgesChange,
      canUndo,
      canRedo,
    }),
    [nodes, edges, onNodesChange, onEdgesChange, canUndo, canRedo]
  );

  const actionsValue = useMemo<FlowActionsValue>(
    () => ({
      onConnect,
      isValidConnection,
      addNode,
      removeNode,
      insertRerouteOnEdge,
      updateNodeData,
      updateNodePosition,
      loadGraph,
      clearGraph,
      getNode,
      getConnectedInputs,
      undo,
      redo,
      recordDragEnd,
    }),
    [onConnect, isValidConnection, addNode, removeNode, insertRerouteOnEdge, updateNodeData, 
     updateNodePosition, loadGraph, clearGraph, getNode, getConnectedInputs, undo, redo, recordDragEnd]
  );

  return (
    <ReactFlowProvider>
      <SelectionContext.Provider value={selectionValue}>
        <FlowStateContext.Provider value={stateValue}>
          <FlowActionsContext.Provider value={actionsValue}>
            <NodePickerContext.Provider value={nodePickerValue}>
              {children}
            </NodePickerContext.Provider>
          </FlowActionsContext.Provider>
        </FlowStateContext.Provider>
      </SelectionContext.Provider>
    </ReactFlowProvider>
  );
}

export function useSelection(): SelectionValue {
  const context = useContext(SelectionContext);
  if (!context) {
    throw new Error('useSelection must be used within a FlowProvider');
  }
  return context;
}

export function useFlowState(): FlowStateValue {
  const context = useContext(FlowStateContext);
  if (!context) {
    throw new Error('useFlowState must be used within a FlowProvider');
  }
  return context;
}

export function useFlowActions(): FlowActionsValue {
  const context = useContext(FlowActionsContext);
  if (!context) {
    throw new Error('useFlowActions must be used within a FlowProvider');
  }
  return context;
}

export function useNodePicker(): NodePickerValue {
  const context = useContext(NodePickerContext);
  if (!context) {
    throw new Error('useNodePicker must be used within a FlowProvider');
  }
  return context;
}

export function useFlow(): FlowContextValue {
  const selection = useSelection();
  const state = useFlowState();
  const actions = useFlowActions();
  return { ...selection, ...state, ...actions };
}
