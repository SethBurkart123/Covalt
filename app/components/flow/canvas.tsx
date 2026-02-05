'use client';

import { useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ConnectionMode,
  type Node,
  type NodeTypes,
  type EdgeProps,
  BackgroundVariant,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { NODE_DEFINITIONS, SOCKET_TYPES, useFlow, type SocketTypeId } from '@/lib/flow';
import { FlowNode as FlowNodeComponent } from './node';

function buildNodeTypes(): NodeTypes {
  const types: NodeTypes = {};
  for (const id of Object.keys(NODE_DEFINITIONS)) {
    types[id] = FlowNodeComponent;
  }
  return types;
}

const nodeTypes = buildNodeTypes();

// -----------------------------------------------------------------------------
// Edge Rendering
// -----------------------------------------------------------------------------

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

export function FlowCanvas() {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    isValidConnection,
    selectNode,
  } = useFlow();

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: { nodes: Node[] }) => {
      selectNode(selectedNodes.length > 0 ? selectedNodes[0].id : null);
    },
    [selectNode]
  );

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
