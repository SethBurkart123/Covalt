'use client';

import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Edge,
  type Node,
  type OnNodesChange,
  type OnEdgesChange,
} from '@xyflow/react';

import type { FlowNode, FlowEdge, Parameter, SocketTypeId } from './types';
import { getNodeDefinition } from './nodes';
import { canConnect } from './sockets';

function getSocketTypeFromParam(param: Parameter): SocketTypeId {
  if (param.socket?.type) return param.socket.type;
  if (param.type === 'agent') return 'agent';
  if (param.type === 'tools') return 'tools';
  return 'agent';
}

function getSocketTypeForHandle(
  nodes: Node[],
  nodeId: string,
  handleId: string | null | undefined,
  isSource: boolean
): SocketTypeId {
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return isSource ? 'agent' : 'tools';

  const definition = getNodeDefinition(node.type || '');
  if (!definition) return isSource ? 'agent' : 'tools';

  const param = definition.parameters.find(p => p.id === handleId);
  if (!param) return isSource ? 'agent' : 'tools';

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

  return definition.parameters.find(p => p.id === handleId);
}

function countEdgesFrom(
  edges: Edge[],
  source: string,
  handle: string | null | undefined
): number {
  return edges.filter(e => e.source === source && e.sourceHandle === handle).length;
}

function enrichEdgeWithSocketTypes(
  edge: FlowEdge,
  nodes: Node[]
): FlowEdge {
  const sourceType = getSocketTypeForHandle(nodes, edge.source, edge.sourceHandle, true);
  const targetType = getSocketTypeForHandle(nodes, edge.target, edge.targetHandle, false);

  return {
    ...edge,
    type: 'gradient',
    data: {
      ...edge.data,
      sourceType,
      targetType,
    },
  };
}

function generateNodeId(type: string): string {
  return `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function generateEdgeId(source: string, target: string): string {
  return `e-${source}-${target}-${Date.now()}`;
}


interface FlowContextValue {
  nodes: FlowNode[];
  edges: FlowEdge[];

  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: (connection: Connection) => void;
  isValidConnection: (connection: Connection | Edge) => boolean;

  selectedNodeId: string | null;
  selectedNode: FlowNode | null;
  selectNode: (id: string | null) => void;

  addNode: (type: string, position: { x: number; y: number }) => string;
  removeNode: (id: string) => void;
  updateNodeData: (nodeId: string, paramId: string, value: unknown) => void;

  loadGraph: (nodes: FlowNode[], edges: FlowEdge[]) => void;
  clearGraph: () => void;

  getNode: (id: string) => FlowNode | undefined;
  getConnectedInputs: (nodeId: string) => Set<string>;
}

const FlowContext = createContext<FlowContextValue | null>(null);


export function FlowProvider({ children }: { children: ReactNode }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const selectNode = useCallback((id: string | null) => {
    setSelectedNodeId(id);
  }, []);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return (nodes.find(n => n.id === selectedNodeId) as FlowNode) ?? null;
  }, [nodes, selectedNodeId]);

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const sourceType = getSocketTypeForHandle(
        nodes,
        connection.source || '',
        connection.sourceHandle,
        true
      );
      const targetParam = getParameterForHandle(
        nodes,
        connection.target || '',
        connection.targetHandle
      );

      if (!targetParam) return false;
      return canConnect(sourceType, targetParam);
    },
    [nodes]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const sourceType = getSocketTypeForHandle(
        nodes,
        connection.source || '',
        connection.sourceHandle,
        true
      );
      const targetType = getSocketTypeForHandle(
        nodes,
        connection.target || '',
        connection.targetHandle,
        false
      );

      const edge: Edge = {
        ...connection,
        id: generateEdgeId(connection.source || '', connection.target || ''),
        type: 'gradient',
        data: { sourceType, targetType },
      };

      const sourceParam = getParameterForHandle(
        nodes,
        connection.source || '',
        connection.sourceHandle
      );

      setEdges(currentEdges => {
        const currentCount = countEdgesFrom(
          currentEdges,
          connection.source || '',
          connection.sourceHandle
        );

        if (!sourceParam?.maxConnections || currentCount < sourceParam.maxConnections) {
          return addEdge(edge, currentEdges);
        }

        if (sourceParam.onExceedMax === 'replace') {
          const filtered = currentEdges.filter(
            e => !(e.source === connection.source && e.sourceHandle === connection.sourceHandle)
          );
          return addEdge(edge, filtered);
        }

        return currentEdges;
      });
    },
    [nodes, setEdges]
  );

  const addNode = useCallback(
    (type: string, position: { x: number; y: number }): string => {
      const definition = getNodeDefinition(type);
      if (!definition) {
        throw new Error(`Unknown node type: ${type}`);
      }

      const data: Record<string, unknown> = {};
      for (const param of definition.parameters) {
        if ('default' in param && param.default !== undefined) {
          data[param.id] = param.default;
        }
      }

      const id = generateNodeId(type);
      const node: Node = { id, type, position, data };

      setNodes(nds => [...nds, node]);
      return id;
    },
    [setNodes]
  );

  const removeNode = useCallback(
    (id: string) => {
      setNodes(nds => nds.filter(n => n.id !== id));
      setEdges(eds => eds.filter(e => e.source !== id && e.target !== id));

      if (selectedNodeId === id) {
        setSelectedNodeId(null);
      }
    },
    [setNodes, setEdges, selectedNodeId]
  );

  const updateNodeData = useCallback(
    (nodeId: string, paramId: string, value: unknown) => {
      setNodes(nds =>
        nds.map(node =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, [paramId]: value } }
            : node
        )
      );
    },
    [setNodes]
  );

  const loadGraph = useCallback(
    (newNodes: FlowNode[], newEdges: FlowEdge[]) => {
      const enrichedEdges = newEdges.map(edge =>
        enrichEdgeWithSocketTypes(edge, newNodes as Node[])
      );

      setNodes(newNodes as Node[]);
      setEdges(enrichedEdges as Edge[]);
      setSelectedNodeId(null);
    },
    [setNodes, setEdges]
  );

  const clearGraph = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setSelectedNodeId(null);
  }, [setNodes, setEdges]);

  const getNode = useCallback(
    (id: string): FlowNode | undefined => {
      return nodes.find(n => n.id === id) as FlowNode | undefined;
    },
    [nodes]
  );

  const getConnectedInputs = useCallback(
    (nodeId: string): Set<string> => {
      const connected = new Set<string>();
      for (const edge of edges) {
        if (edge.target === nodeId && edge.targetHandle) {
          connected.add(edge.targetHandle);
        }
      }
      return connected;
    },
    [edges]
  );

  const value = useMemo<FlowContextValue>(
    () => ({
      nodes: nodes as FlowNode[],
      edges: edges as FlowEdge[],
      onNodesChange,
      onEdgesChange,
      onConnect,
      isValidConnection,
      selectedNodeId,
      selectedNode,
      selectNode,
      addNode,
      removeNode,
      updateNodeData,
      loadGraph,
      clearGraph,
      getNode,
      getConnectedInputs,
    }),
    [
      nodes,
      edges,
      onNodesChange,
      onEdgesChange,
      onConnect,
      isValidConnection,
      selectedNodeId,
      selectedNode,
      selectNode,
      addNode,
      removeNode,
      updateNodeData,
      loadGraph,
      clearGraph,
      getNode,
      getConnectedInputs,
    ]
  );

  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
}

export function useFlow(): FlowContextValue {
  const context = useContext(FlowContext);
  if (!context) {
    throw new Error('useFlow must be used within a FlowProvider');
  }
  return context;
}
