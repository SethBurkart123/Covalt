'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  ConnectionMode,
  type Node,
  type NodeTypes,
  type EdgeProps,
  type OnConnectStartParams,
  type FinalConnectionState,
  BackgroundVariant,
  Position,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { NODE_DEFINITIONS, SOCKET_TYPES, useFlow, getNodeDefinition, type SocketTypeId } from '@/lib/flow';
import { FlowNode as FlowNodeComponent } from './node';
import { AddNodeMenu, type ConnectionFilter } from './add-node-menu';
import { cn } from '@/lib/utils';

/** Info about a pending connection from dragging onto empty space */
interface PendingConnection {
  nodeId: string;
  handleId: string;
  handleType: 'source' | 'target';
  socketType: SocketTypeId;
}

function buildNodeTypes(): NodeTypes {
  const types: NodeTypes = {};
  for (const id of Object.keys(NODE_DEFINITIONS)) {
    types[id] = FlowNodeComponent;
  }
  return types;
}

const nodeTypes = buildNodeTypes();


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

function getBezierPathString(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number }
): string {
  return `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`;
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

  // Different colors rendered with a gradient via mask
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

const edgeTypes = {
  gradient: GradientEdge,
};

function FlowCanvasInner() {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    isValidConnection,
    selectNode,
    addNode,
    removeNode,
    updateNodePosition,
    undo,
    redo,
    canUndo,
    canRedo,
    recordDragEnd,
  } = useFlow();

  const { screenToFlowPosition } = useReactFlow();
  const mousePositionRef = useRef({ x: 0, y: 0 });
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [addMenuPosition, setAddMenuPosition] = useState({ x: 0, y: 0 });
  const [placingNodeId, setPlacingNodeId] = useState<string | null>(null);
  const originalPositionRef = useRef<{ x: number; y: number } | null>(null);
  const pendingConnectionRef = useRef<PendingConnection | null>(null); // ref to avoid stale closures
  const [connectionFilter, setConnectionFilter] = useState<ConnectionFilter | null>(null);

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: { nodes: Node[] }) => {
      if (placingNodeId) return;
      selectNode(selectedNodes.length > 0 ? selectedNodes[0].id : null);
    },
    [selectNode, placingNodeId]
  );

  const onNodeDragStop = useCallback(() => {
    recordDragEnd();
  }, [recordDragEnd]);

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      mousePositionRef.current = { x: e.clientX, y: e.clientY };
      if (placingNodeId) {
        updateNodePosition(placingNodeId, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
      }
    },
    [placingNodeId, screenToFlowPosition, updateNodePosition]
  );

  // Left-click to confirm placement
  useEffect(() => {
    if (!placingNodeId) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('[data-add-node-menu]')) return;

      e.preventDefault();
      e.stopPropagation();
      recordDragEnd();
      setPlacingNodeId(null);
      originalPositionRef.current = null;
    };

    window.addEventListener('mousedown', handleMouseDown, true); // capture before ReactFlow
    return () => window.removeEventListener('mousedown', handleMouseDown, true);
  }, [placingNodeId, recordDragEnd]);

  const openAddMenu = useCallback((filter?: ConnectionFilter) => {
    setAddMenuPosition(mousePositionRef.current);
    setConnectionFilter(filter ?? null);
    setIsAddMenuOpen(true);
  }, []);

  const getSocketTypeFromHandle = useCallback((nodeId: string, handleId: string): SocketTypeId | null => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return null;
    const definition = getNodeDefinition(node.type || '');
    if (!definition) return null;
    const param = definition.parameters.find(p => p.id === handleId);
    if (!param || !('socket' in param) || !param.socket) return null;
    return param.socket.type as SocketTypeId;
  }, [nodes]);

  const handleConnectStart = useCallback(
    (_event: MouseEvent | TouchEvent, params: OnConnectStartParams) => {
      if (!params.nodeId || !params.handleId || !params.handleType) return;
      const socketType = getSocketTypeFromHandle(params.nodeId, params.handleId);
      if (!socketType) return;
      pendingConnectionRef.current = {
        nodeId: params.nodeId,
        handleId: params.handleId,
        handleType: params.handleType,
        socketType,
      };
    },
    [getSocketTypeFromHandle]
  );

  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      const pending = pendingConnectionRef.current;
      
      if (connectionState.toHandle) {
        pendingConnectionRef.current = null;
        return;
      }
      
      // Dropped on empty space - open filtered add menu (keep ref for handleAddNodeWithSocket)
      if (pending && !connectionState.toNode) {
        const clientX = 'clientX' in event ? event.clientX : event.touches?.[0]?.clientX ?? 0;
        const clientY = 'clientY' in event ? event.clientY : event.touches?.[0]?.clientY ?? 0;
        mousePositionRef.current = { x: clientX, y: clientY };
        openAddMenu({ socketType: pending.socketType, needsInput: pending.handleType === 'source' });
        return;
      }
      
      pendingConnectionRef.current = null;
    },
    [openAddMenu]
  );

  const handleAddNode = useCallback(
    (nodeType: string) => {
      const flowPosition = screenToFlowPosition(mousePositionRef.current);
      const newNodeId = addNode(nodeType, flowPosition);
      selectNode(newNodeId);
      originalPositionRef.current = flowPosition;
      setPlacingNodeId(newNodeId);
      pendingConnectionRef.current = null;
      setConnectionFilter(null);
    },
    [addNode, selectNode, screenToFlowPosition]
  );

  const handleAddNodeWithSocket = useCallback(
    (nodeType: string, socketId: string) => {
      const pending = pendingConnectionRef.current;
      if (!pending) return;
      
      const flowPosition = screenToFlowPosition(mousePositionRef.current);
      const newNodeId = addNode(nodeType, flowPosition);
      selectNode(newNodeId);
      
      const newNodeDef = getNodeDefinition(nodeType);
      const newSocketParam = newNodeDef?.parameters.find(p => p.id === socketId);
      const newSocketType: SocketTypeId = (newSocketParam as { socket?: { type: SocketTypeId } })?.socket?.type ?? 'agent';
      
      // Connect based on drag direction: source→target or target→source
      if (pending.handleType === 'source') {
        onConnect(
          { source: pending.nodeId, sourceHandle: pending.handleId, target: newNodeId, targetHandle: socketId },
          { sourceType: pending.socketType, targetType: newSocketType }
        );
      } else {
        onConnect(
          { source: newNodeId, sourceHandle: socketId, target: pending.nodeId, targetHandle: pending.handleId },
          { sourceType: newSocketType, targetType: pending.socketType }
        );
      }
      
      pendingConnectionRef.current = null;
      setConnectionFilter(null);
    },
    [addNode, selectNode, onConnect, screenToFlowPosition]
  );

  // Shift+A: add menu, Escape: cancel placement
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key.toLowerCase() === 'a' && !placingNodeId) {
        e.preventDefault();
        openAddMenu();
      }
      if (e.key === 'Escape' && placingNodeId) {
        e.preventDefault();
        removeNode(placingNodeId);
        selectNode(null);
        setPlacingNodeId(null);
        originalPositionRef.current = null;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openAddMenu, placingNodeId, removeNode, selectNode]);

  // Cmd/Ctrl+Z for undo, Cmd/Ctrl+Shift+Z for redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod || e.key.toLowerCase() !== 'z') return;

      e.preventDefault();
      if (e.shiftKey) {
        if (canRedo) redo();
      } else {
        if (canUndo) undo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, canUndo, canRedo]);

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();

      // Cancel placement and restore original position
      if (placingNodeId && originalPositionRef.current) {
        updateNodePosition(placingNodeId, originalPositionRef.current);
        recordDragEnd();
        setPlacingNodeId(null);
        originalPositionRef.current = null;
        return;
      }

      if ((e.target as HTMLElement).closest('.react-flow__node')) return;
      mousePositionRef.current = { x: e.clientX, y: e.clientY };
      openAddMenu();
    },
    [openAddMenu, placingNodeId, recordDragEnd, updateNodePosition]
  );

  return (
    <div
      className={cn('w-full h-full bg-background', placingNodeId && 'cursor-grabbing')}
      onMouseMove={onMouseMove}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        onSelectionChange={onSelectionChange}
        onNodeDragStop={onNodeDragStop}
        onContextMenu={onContextMenu}
        connectionMode={ConnectionMode.Loose}
        isValidConnection={isValidConnection}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
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

      <AddNodeMenu
        isOpen={isAddMenuOpen}
        onClose={() => {
          setIsAddMenuOpen(false);
          pendingConnectionRef.current = null;
          setConnectionFilter(null);
        }}
        position={addMenuPosition}
        onSelect={handleAddNode}
        connectionFilter={connectionFilter ?? undefined}
        onSelectWithSocket={handleAddNodeWithSocket}
      />
    </div>
  );
}

export function FlowCanvas() {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner />
    </ReactFlowProvider>
  );
}
