'use client';

import { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  ConnectionMode,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
  type EdgeProps,
  BackgroundVariant,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { NODE_DEFINITIONS, getNodeDefinition, SOCKET_TYPES, canConnect, type FlowNode, type FlowEdge, type SocketTypeId, type Parameter } from '@/lib/flow';
import { FlowNode as FlowNodeComponent } from './node';

function buildNodeTypes(): NodeTypes {
  const types: NodeTypes = {};
  for (const id of Object.keys(NODE_DEFINITIONS)) {
    types[id] = FlowNodeComponent;
  }
  return types;
}

const nodeTypes = buildNodeTypes();

function enrichEdgesWithSocketTypes(edges: FlowEdge[], nodes: Node[]): FlowEdge[] {
  return edges.map(edge => {
    if (edge.data?.sourceType && edge.data?.targetType) {
      return edge;
    }
    
    const sourceNode = nodes.find(n => n.id === edge.source);
    const targetNode = nodes.find(n => n.id === edge.target);
    
    const sourceType = sourceNode ? getSocketTypeForHandleStatic(sourceNode, edge.sourceHandle, true) : 'agent';
    const targetType = targetNode ? getSocketTypeForHandleStatic(targetNode, edge.targetHandle, false) : 'tools';
    
    return {
      ...edge,
      data: {
        ...edge.data,
        sourceType,
        targetType,
      },
    };
  });
}

function getSocketTypeForHandleStatic(node: Node, handleId: string | null | undefined, isSource: boolean): SocketTypeId {
  const definition = getNodeDefinition(node.type || '');
  if (!definition) return isSource ? 'agent' : 'tools';
  
  const param = definition.parameters.find(p => p.id === handleId);
  if (!param) return isSource ? 'agent' : 'tools';
  
  return getSocketTypeFromParam(param);
}

function getSocketTypeFromParam(param: Parameter): SocketTypeId {
  if (param.socket?.type) {
    return param.socket.type;
  }
  if (param.type === 'agent') return 'agent';
  if (param.type === 'tools') return 'tools';
  return 'agent';
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

function countEdgesFrom(edges: Edge[], source: string, handle: string | null | undefined): number {
  return edges.filter(e => e.source === source && e.sourceHandle === handle).length;
}

function getControlPoints(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  sourcePosition: Position,
  targetPosition: Position
): {
  p0: { x: number; y: number };
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  p3: { x: number; y: number };
} {
  const horizontalDist = Math.abs(targetX - sourceX);
  const offset = Math.max(25, Math.min(horizontalDist * 0.5, 150));

  const p0 = { x: sourceX, y: sourceY };
  const p3 = { x: targetX, y: targetY };

  let p1: { x: number; y: number };
  let p2: { x: number; y: number };

  switch (sourcePosition) {
    case Position.Right:
      p1 = { x: sourceX + offset, y: sourceY };
      break;
    case Position.Left:
      p1 = { x: sourceX - offset, y: sourceY };
      break;
    case Position.Bottom:
      p1 = { x: sourceX, y: sourceY + offset };
      break;
    case Position.Top:
      p1 = { x: sourceX, y: sourceY - offset };
      break;
    default:
      p1 = { x: sourceX + offset, y: sourceY };
  }

  switch (targetPosition) {
    case Position.Left:
      p2 = { x: targetX - offset, y: targetY };
      break;
    case Position.Right:
      p2 = { x: targetX + offset, y: targetY };
      break;
    case Position.Top:
      p2 = { x: targetX, y: targetY - offset };
      break;
    case Position.Bottom:
      p2 = { x: targetX, y: targetY + offset };
      break;
    default:
      p2 = { x: targetX - offset, y: targetY };
  }

  return { p0, p1, p2, p3 };
}

function GradientEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const { p0, p1, p2, p3 } = getControlPoints(
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition || Position.Right,
    targetPosition || Position.Left
  );

  const sourceType = (data?.sourceType as SocketTypeId) || 'tools';
  const targetType = (data?.targetType as SocketTypeId) || 'tools';
  const sourceColor = SOCKET_TYPES[sourceType]?.color || '#f59e0b';
  const targetColor = SOCKET_TYPES[targetType]?.color || '#f59e0b';

  const pathD = getBezierPathString(p0, p1, p2, p3);
  
  if (sourceType === targetType) {
    return (
      <path
        d={pathD}
        stroke={targetColor}
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
      />
    );
  }

  const padding = 20;
  const minX = Math.min(sourceX, targetX, p1.x, p2.x) - padding;
  const minY = Math.min(sourceY, targetY, p1.y, p2.y) - padding;
  const maxX = Math.max(sourceX, targetX, p1.x, p2.x) + padding;
  const maxY = Math.max(sourceY, targetY, p1.y, p2.y) + padding;
  const width = maxX - minX;
  const height = maxY - minY;

  const angle = 90 + Math.atan2(targetY - sourceY, targetX - sourceX) * (180 / Math.PI);

  const maskId = `edge-mask-${id}`;
  
  return (
    <>
      <defs>
        <mask id={maskId}>
          <path
            d={pathD}
            stroke="white"
            strokeWidth={2}
            fill="none"
            strokeLinecap="round"
          />
        </mask>
      </defs>
      <foreignObject
        x={minX}
        y={minY}
        width={width}
        height={height}
        mask={`url(#${maskId})`}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            background: `linear-gradient(${angle}deg in oklch, ${sourceColor} 15%, 50%, ${targetColor} 85%)`,
          }}
        />
      </foreignObject>
    </>
  );
}

function getBezierPathString(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number }
): string {
  return `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`;
}

interface FlowCanvasProps {
  initialNodes?: FlowNode[];
  initialEdges?: FlowEdge[];
  onNodeSelect?: (nodeId: string | null) => void;
}

export function FlowCanvas({
  initialNodes = [],
  initialEdges = [],
  onNodeSelect,
}: FlowCanvasProps) {
  const [nodes, , onNodesChange] = useNodesState(initialNodes as Node[]);
  
  const enrichedInitialEdges = useMemo(() => {
    return enrichEdgesWithSocketTypes(initialEdges, initialNodes as Node[]);
  }, []);
  
  const [edges, setEdges, onEdgesChange] = useEdgesState(enrichedInitialEdges as Edge[]);

  const getSocketTypeForHandle = useCallback((nodeId: string, handleId: string | null | undefined, isSource: boolean): SocketTypeId => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return isSource ? 'agent' : 'tools';
    
    const definition = getNodeDefinition(node.type || '');
    if (!definition) return isSource ? 'agent' : 'tools';
    
    const param = definition.parameters.find(p => p.id === handleId);
    if (!param) return isSource ? 'agent' : 'tools';
    
    return getSocketTypeFromParam(param);
  }, [nodes]);

  const onConnect = useCallback((connection: Connection) => {
    const sourceType = getSocketTypeForHandle(connection.source, connection.sourceHandle, true);
    const targetType = getSocketTypeForHandle(connection.target, connection.targetHandle, false);
    
    const edge: Edge = {
      ...connection,
      id: `e-${connection.source}-${connection.target}-${Date.now()}`,
      type: 'gradient',
      data: { sourceType, targetType },
    };
    
    const sourceParam = getParameterForHandle(nodes, connection.source || '', connection.sourceHandle);
    
    setEdges((currentEdges) => {
      const currentCount = countEdgesFrom(currentEdges, connection.source || '', connection.sourceHandle);
      
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
  }, [nodes, setEdges, getSocketTypeForHandle]);

  const onSelectionChange = useCallback(({ nodes: selectedNodes }: { nodes: Node[] }) => {
    if (onNodeSelect) {
      onNodeSelect(selectedNodes.length > 0 ? selectedNodes[0].id : null);
    }
  }, [onNodeSelect]);

  const isValidConnection = useCallback((connection: Edge | Connection) => {
    const sourceType = getSocketTypeForHandle(connection.source || '', connection.sourceHandle, true);
    const targetParam = getParameterForHandle(nodes, connection.target || '', connection.targetHandle);
    
    if (!targetParam) return false;
    
    return canConnect(sourceType, targetParam);
  }, [nodes]);

  const edgeTypes = {
    gradient: GradientEdge,
  };

  return (
    <div className="w-full h-full bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onSelectionChange={onSelectionChange}
        connectionMode={ConnectionMode.Loose}
        isValidConnection={isValidConnection}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        snapToGrid
        snapGrid={[16, 16]}
        defaultEdgeOptions={{
          type: 'gradient',
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          className="!stroke-muted-foreground/20"
        />
        <Controls
          className="bg-card [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-muted-foreground [&>button:hover]:!bg-muted"
        />
        <MiniMap
          className="!bg-card !border-border"
          nodeColor="hsl(var(--muted))"
          maskColor="hsl(var(--background) / 0.7)"
        />
      </ReactFlow>
    </div>
  );
}
