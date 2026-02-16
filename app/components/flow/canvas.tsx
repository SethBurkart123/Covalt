'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ConnectionMode,
  type Node,
  type Edge,
  type NodeChange,
  type NodeTypes,
  type EdgeProps,
  type ConnectionLineComponentProps,
  type OnConnectStartParams,
  type FinalConnectionState,
  BackgroundVariant,
  Position,
  useReactFlow,
  useStoreApi,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { XYHandle } from '@xyflow/system';
import { Square, X } from 'lucide-react';

import {
  NODE_DEFINITIONS,
  SOCKET_TYPES,
  useFlowState,
  useFlowActions,
  useSelection,
  getNodeDefinition,
  getCompatibleNodeSockets,
  type SocketTypeId,
  type FlowNode,
  useNodePicker,
  resolveParameterForHandle,
} from '@/lib/flow';
import { useFlowExecution } from '@/contexts/flow-execution-context';
import { useFlowRunner } from '@/lib/flow/use-flow-runner';
import { FlowRunPrompt } from './flow-run-prompt';
import { FlowNode as FlowNodeComponent } from './node';
import { RerouteNode } from './reroute-node';
import { AddNodeMenu, type ConnectionFilter } from './add-node-menu';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface PendingConnection {
  nodeId: string;
  handleId: string;
  handleType: 'source' | 'target';
  socketType: SocketTypeId;
}

function buildNodeTypes(): NodeTypes {
  const types: NodeTypes = {};
  for (const id of Object.keys(NODE_DEFINITIONS)) {
    types[id] = id === 'reroute' ? RerouteNode : FlowNodeComponent;
  }
  return types;
}

const nodeTypes = buildNodeTypes();

const EDGE_INSET = 5;

function insetPoint(x: number, y: number, position: Position, amount: number): { x: number; y: number } {
  switch (position) {
    case Position.Right:  return { x: x - amount, y };
    case Position.Left:   return { x: x + amount, y };
    case Position.Bottom: return { x, y: y - amount };
    case Position.Top:    return { x, y: y + amount };
    default:              return { x, y };
  }
}

function getControlPoints(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  sourcePosition: Position,
  targetPosition: Position,
  insetAmount: number = EDGE_INSET
): {
  p0: { x: number; y: number };
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  p3: { x: number; y: number };
} {
  const horizontalDist = Math.abs(targetX - sourceX);
  const offset = Math.max(25, Math.min(horizontalDist * 0.5, 150));

  const p0 = insetPoint(sourceX, sourceY, sourcePosition, insetAmount);
  const p3 = insetPoint(targetX, targetY, targetPosition, insetAmount);

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

const GradientEdge = memo(function GradientEdge({
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

  const sourceType = (data?.sourceType ?? 'tools') as SocketTypeId;
  const targetType = (data?.targetType ?? 'tools') as SocketTypeId;
  const sourceColor = SOCKET_TYPES[sourceType]?.color || '#f59e0b';
  const targetColor = SOCKET_TYPES[targetType]?.color || '#f59e0b';

  const pathD = getBezierPathString(p0, p1, p2, p3);
  const interactionPath = (
    <path
      d={pathD}
      stroke="rgba(0,0,0,0)"
      strokeWidth={12}
      fill="none"
      pointerEvents="stroke"
    />
  );

  if (sourceType === targetType) {
    return (
      <>
        {interactionPath}
        <path
          d={pathD}
          stroke={targetColor}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
        />
      </>
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
      {interactionPath}
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
});

function CustomConnectionLine({
  fromNode,
  fromHandle,
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
}: ConnectionLineComponentProps) {
  const definition = getNodeDefinition(fromNode.type || '');
  const param = definition ? resolveParameterForHandle(definition, fromNode as FlowNode, fromHandle.id) : undefined;
  const socketType = (param?.socket?.type ?? 'tools') as SocketTypeId;
  const { p0, p1, p2, p3 } = getControlPoints(
    fromX,
    fromY,
    toX,
    toY,
    fromPosition,
    toPosition,
    0
  );

  return (
    <g>
      <path
        d={getBezierPathString(p0, p1, p2, p3)}
        stroke={SOCKET_TYPES[socketType]?.color || '#f59e0b'}
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
      />
    </g>
  );
}

const edgeTypes = {
  gradient: GradientEdge,
};

const defaultEdgeOptions = {
  type: 'gradient',
} as const;

interface FlowCanvasProps {
  onNodeDoubleClick?: (nodeId: string) => void;
}

function FlowCanvasInner({ onNodeDoubleClick }: FlowCanvasProps) {
  const { nodes, edges, onNodesChange, onEdgesChange, canUndo, canRedo } = useFlowState();
  const { executionByNode } = useFlowExecution();
  const { isRunning, stopRun } = useFlowRunner();
  const { selectNode } = useSelection();
  const picker = useNodePicker();
  const {
    onConnect,
    isValidConnection,
    addNode,
    removeNode,
    insertRerouteOnEdge,
    updateNodePosition,
    updateNodeData,
    undo,
    redo,
    recordDragEnd,
  } = useFlowActions();

  const { screenToFlowPosition, getNodes, fitView } = useReactFlow();
  const store = useStoreApi();
  const mousePositionRef = useRef({ x: 0, y: 0 });
  const isHoveringCanvasRef = useRef(false);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [addMenuPosition, setAddMenuPosition] = useState({ x: 0, y: 0 });
  const [placingNodeId, setPlacingNodeId] = useState<string | null>(null);
  const originalPositionRef = useRef<{ x: number; y: number } | null>(null);
  const pendingConnectionRef = useRef<PendingConnection | null>(null);
  const rerouteDragActiveRef = useRef(false);
  const [connectionFilter, setConnectionFilter] = useState<ConnectionFilter | null>(null);

  const displayNodes = useMemo(() => {
    if (!nodes.length) return nodes;
    return nodes.map((node) => {
      const snapshot = executionByNode[node.id];
      if (!snapshot) return node;
      return {
        ...node,
        data: {
          ...node.data,
          _executionStatus: snapshot.status,
          _executionError: snapshot.error,
          _executionNodeType: snapshot.nodeType,
        },
      };
    });
  }, [nodes, executionByNode]);

  const pickerMessage = picker.allowedNodeTypes?.[0]
    ? `Pick the ${picker.allowedNodeTypes[0]} node from the graph`
    : 'Pick a node from the graph';

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (picker.active) {
        const filtered = changes.filter(change => change.type !== 'select');
        if (filtered.length === 0) return;
        onNodesChange(filtered);
        return;
      }
      onNodesChange(changes);
    },
    [onNodesChange, picker.active]
  );

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: { nodes: Node[] }) => {
      if (placingNodeId || picker.active) return;
      selectNode(selectedNodes.length > 0 ? selectedNodes[0].id : null);
    },
    [selectNode, placingNodeId, picker.active]
  );

  const handleNodeDoubleClick = useCallback(
    (_event: unknown, node: Node) => {
      if (placingNodeId || picker.active) return;
      selectNode(node.id);
      onNodeDoubleClick?.(node.id);
    },
    [onNodeDoubleClick, placingNodeId, picker.active, selectNode]
  );

  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      if (!picker.active) return;
      event.preventDefault();
      event.stopPropagation();
      if (!picker.isPickableNode(node.id, node.type)) return;

      const originNodeId = picker.originNodeId;
      const paramId = picker.paramId;

      if (originNodeId) {
        selectNode(originNodeId);
        const originNode = getNodes().find(n => n.id === originNodeId);
        if (originNode) {
          fitView({ nodes: [originNode], duration: 300, padding: 0.6 });
        }
      }

      if (originNodeId && paramId) {
        updateNodeData(originNodeId, paramId, node.id);
      }

      picker.completePick();
    },
    [fitView, getNodes, picker, selectNode, updateNodeData]
  );

  const onNodeDragStop = useCallback(() => {
    recordDragEnd();
  }, [recordDragEnd]);

  useEffect(() => {
    const handleMouseUp = () => {
      rerouteDragActiveRef.current = false;
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      mousePositionRef.current = { x: e.clientX, y: e.clientY };
      if (placingNodeId) {
        updateNodePosition(placingNodeId, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
      }
    },
    [placingNodeId, screenToFlowPosition, updateNodePosition]
  );

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

    window.addEventListener('mousedown', handleMouseDown, true);
    return () => window.removeEventListener('mousedown', handleMouseDown, true);
  }, [placingNodeId, recordDragEnd]);

  const openAddMenu = useCallback((filter?: ConnectionFilter) => {
    setAddMenuPosition(mousePositionRef.current);
    setConnectionFilter(filter ?? null);
    setIsAddMenuOpen(true);
  }, []);

  const closeAddMenu = useCallback(() => {
    setIsAddMenuOpen(false);
    pendingConnectionRef.current = null;
    setConnectionFilter(null);
  }, []);

  const getSocketTypeFromHandle = useCallback((nodeId: string, handleId: string): SocketTypeId | null => {
    const node = nodesRef.current.find(n => n.id === nodeId);
    if (!node) return null;
    if (node.type === 'reroute') {
      const socketType = (node.data as { _socketType?: unknown } | undefined)?._socketType;
      if (typeof socketType === 'string' && socketType) {
        return socketType as SocketTypeId;
      }
    }
    const definition = getNodeDefinition(node.type || '');
    if (!definition) return null;
    const param = resolveParameterForHandle(definition, node as FlowNode, handleId);
    if (!param || !('socket' in param) || !param.socket) return null;
    return param.socket.type as SocketTypeId;
  }, []);

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
      const newDefinition = getNodeDefinition(nodeType);
      const newParam = newDefinition
        ? resolveParameterForHandle(
            newDefinition,
            { id: newNodeId, type: nodeType, position: flowPosition, data: {} } as FlowNode,
            socketId
          )
        : null;
      const newSocketType: SocketTypeId = newParam?.socket?.type ?? 'data';

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

  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      const pending = pendingConnectionRef.current;
      
      if (connectionState.toHandle) {
        pendingConnectionRef.current = null;
        return;
      }
      
      if (pending) {
        const clientX = 'clientX' in event ? event.clientX : event.touches?.[0]?.clientX ?? 0;
        const clientY = 'clientY' in event ? event.clientY : event.touches?.[0]?.clientY ?? 0;

        const target = document.elementFromPoint(clientX, clientY);
        const isInsideCanvas = target?.closest('.react-flow');
        const isOverUI = target?.closest('.react-flow__controls, .react-flow__minimap, .react-flow__panel')
          || !isInsideCanvas;

        const flowPos = screenToFlowPosition({ x: clientX, y: clientY });
        const isOverNode = getNodes().some((n) => {
          const w = n.measured?.width ?? n.width ?? 0;
          const h = n.measured?.height ?? n.height ?? 0;
          return (
            flowPos.x >= n.position.x &&
            flowPos.x <= n.position.x + w &&
            flowPos.y >= n.position.y &&
            flowPos.y <= n.position.y + h
          );
        });

        if (isOverUI || isOverNode) {
          pendingConnectionRef.current = null;
          return;
        }

        mousePositionRef.current = { x: clientX, y: clientY };
        const filter = { socketType: pending.socketType, needsInput: pending.handleType === 'source' };
        const compatible = getCompatibleNodeSockets(filter.socketType, filter.needsInput);
        if (compatible.length === 1) {
          const only = compatible[0];
          handleAddNodeWithSocket(only.nodeId, only.socketId);
          return;
        }
        openAddMenu(filter);
        return;
      }
      
      pendingConnectionRef.current = null;
    },
    [openAddMenu, getNodes, screenToFlowPosition, handleAddNodeWithSocket]
  );

  const startConnectionFromReroute = useCallback(
    (nodeId: string, clientX: number, clientY: number) => {
      const state = store.getState();
      const domNode = state.domNode;
      if (!domNode) return;

      const handleDomNode = domNode.querySelector(
        `.react-flow__node[data-id=\"${nodeId}\"] .react-flow__handle[data-handleid=\"output\"]`
      ) as HTMLElement | null;
      if (!handleDomNode) return;

      const fakeEvent = {
        clientX,
        clientY,
        target: handleDomNode,
        currentTarget: handleDomNode,
        button: 0,
        buttons: 1,
        pointerType: 'mouse',
        preventDefault: () => {},
        stopPropagation: () => {},
      } as unknown as PointerEvent;

      XYHandle.onPointerDown(fakeEvent, {
        connectionMode: state.connectionMode,
        connectionRadius: state.connectionRadius,
        handleId: 'output',
        nodeId,
        edgeUpdaterType: undefined,
        isTarget: false,
        domNode,
        nodeLookup: state.nodeLookup,
        lib: state.lib,
        autoPanOnConnect: state.autoPanOnConnect,
        flowId: state.rfId,
        panBy: state.panBy,
        cancelConnection: state.cancelConnection,
        onConnectStart: state.onConnectStart,
        onConnect: state.onConnect,
        onConnectEnd: state.onConnectEnd,
        isValidConnection: state.isValidConnection,
        onReconnectEnd: state.onReconnectEnd,
        updateConnection: state.updateConnection,
        getTransform: () => state.transform,
        getFromHandle: () => state.connection.fromHandle,
        autoPanSpeed: state.autoPanSpeed,
        dragThreshold: 0,
        handleDomNode,
      });
    },
    [store]
  );

  const maybeInsertReroute = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      if (!event.shiftKey) return;
      const rightButtonDown = (event.buttons & 2) === 2;
      if (!rightButtonDown) return;
      if (rerouteDragActiveRef.current) return;

      event.preventDefault();
      event.stopPropagation();
      rerouteDragActiveRef.current = true;

      const flowPos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const rerouteId = insertRerouteOnEdge(edge.id, flowPos);
      if (!rerouteId) {
        rerouteDragActiveRef.current = false;
        return;
      }

      const { clientX, clientY } = event;
      requestAnimationFrame(() => {
        startConnectionFromReroute(rerouteId, clientX, clientY);
      });
    },
    [insertRerouteOnEdge, screenToFlowPosition, startConnectionFromReroute]
  );

  const handleEdgeMouseEnter = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      maybeInsertReroute(event, edge);
    },
    [maybeInsertReroute]
  );

  const handleEdgeMouseMove = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      maybeInsertReroute(event, edge);
    },
    [maybeInsertReroute]
  );

  const handleEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      if (!event.shiftKey) return;
      event.preventDefault();
      event.stopPropagation();
      if (rerouteDragActiveRef.current) return;
      const flowPos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      insertRerouteOnEdge(edge.id, flowPos);
    },
    [insertRerouteOnEdge, screenToFlowPosition]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const isInputFocused =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active?.getAttribute('contenteditable') === 'true';

      if (
        e.shiftKey &&
        e.key.toLowerCase() === 'a' &&
        !placingNodeId &&
        !isInputFocused &&
        isHoveringCanvasRef.current
      ) {
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

  useEffect(() => {
    if (!picker.active) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      picker.cancelPick();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [picker.active, picker.cancelPick]);

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (e.shiftKey) return;

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

  const handleMoveStart = useCallback(() => {
    if (isAddMenuOpen) closeAddMenu();
  }, [closeAddMenu, isAddMenuOpen]);

  const handleNodeDragStart = useCallback(() => {
    if (isAddMenuOpen) closeAddMenu();
  }, [closeAddMenu, isAddMenuOpen]);

  return (
    <div
      className={cn('w-full h-full bg-background', placingNodeId && 'cursor-grabbing', picker.active && 'cursor-crosshair')}
      onMouseMove={onMouseMove}
      onMouseEnter={() => { isHoveringCanvasRef.current = true; }}
      onMouseLeave={() => { isHoveringCanvasRef.current = false; }}
    >
      <ReactFlow
        nodes={displayNodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        onEdgeMouseEnter={handleEdgeMouseEnter}
        onEdgeMouseMove={handleEdgeMouseMove}
        onEdgeContextMenu={handleEdgeContextMenu}
        onSelectionChange={onSelectionChange}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onContextMenu={onContextMenu}
        onMoveStart={handleMoveStart}
        connectionMode={ConnectionMode.Loose}
        isValidConnection={isValidConnection}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        defaultEdgeOptions={defaultEdgeOptions}
        connectionLineComponent={CustomConnectionLine}
        proOptions={{ hideAttribution: true }}
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        panActivationKeyCode={null}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          className="!stroke-muted-foreground/20 [&_rect]:!stroke-transparent"
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
        onClose={closeAddMenu}
        position={addMenuPosition}
        onSelect={handleAddNode}
        connectionFilter={connectionFilter ?? undefined}
        onSelectWithSocket={handleAddNodeWithSocket}
      />
      <FlowRunPrompt />
      {picker.active && (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-card/95 px-4 py-2 shadow-lg">
            <span className="text-xs text-muted-foreground">
              {pickerMessage}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={picker.cancelPick}
            >
              <X className="size-3.5" />
              Cancel
            </Button>
          </div>
        </div>
      )}
      {isRunning && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center">
          <div className="pointer-events-auto">
            <Button
              variant="destructive"
              size="lg"
              className="rounded-full px-6 shadow-lg"
              onClick={stopRun}
            >
              <Square className="size-4" />
              Stop Run
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export { FlowCanvasInner as FlowCanvas };
