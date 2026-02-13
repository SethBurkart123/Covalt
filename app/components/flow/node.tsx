'use client';

import { memo, useCallback, useMemo, type ComponentType } from 'react';
import { useStore, type NodeProps } from '@xyflow/react';
import { ChevronDown, Check, X, Loader2 } from 'lucide-react';
import * as Icons from 'lucide-react';
import type { NodeDefinition, FlowEdge, Parameter } from '@/lib/flow';
import type { FlowNodeExecutionSnapshot } from '@/contexts/agent-test-chat-context';
import { getNodeDefinition, useFlowActions } from '@/lib/flow';
import { ParameterRow } from './parameter-row';
import { buildNodeEdgeIndex, shouldRenderParam } from './parameter-visibility';
import { cn } from '@/lib/utils';
import { Socket } from './socket';

interface FlowNodeData {
  [key: string]: unknown;
}

interface FlowNodeProps extends NodeProps {
  data: FlowNodeData;
  type: string;
}

interface SocketParamItem {
  param: Parameter;
  side: 'left' | 'right';
}

type ParamBlock =
  | { kind: 'compact'; items: SocketParamItem[] }
  | { kind: 'normal'; param: Parameter };

function getIcon(name: string) {
  const IconComponent = (Icons as unknown as Record<string, ComponentType<{ className?: string }>>)[name];
  return IconComponent ?? Icons.Circle;
}

function getSocketSide(param: Parameter): 'left' | 'right' {
  return param.socket?.side ?? (param.mode === 'output' ? 'right' : 'left');
}

function isSocketOnlyParam(param: Parameter, isConnected: boolean): boolean {
  if (!param.socket) return false;
  if (param.mode === 'input' || param.mode === 'output') return true;
  return param.mode === 'hybrid' && isConnected;
}

const CompactSocketRow = memo(function CompactSocketRow({ left, right }: { left?: SocketParamItem; right?: SocketParamItem }) {
  return (
    <div className="relative flex items-center h-7 px-3">
      {left && (
        <div className="flex items-center gap-1.5">
          <Socket
            id={left.param.id}
            type={left.param.socket?.type ?? 'data'}
            side="left"
            mode={left.param.mode}
            bidirectional={left.param.socket?.bidirectional}
            config={left.param.socket}
          />
          <span className="text-xs text-muted-foreground">{left.param.label}</span>
        </div>
      )}

      {right && (
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground text-right">{right.param.label}</span>
          <Socket
            id={right.param.id}
            type={right.param.socket?.type ?? 'data'}
            side="right"
            mode={right.param.mode}
            bidirectional={right.param.socket?.bidirectional}
            config={right.param.socket}
          />
        </div>
      )}
    </div>
  );
});

const CompactSocketGroup = memo(function CompactSocketGroup({ items }: { items: SocketParamItem[] }) {
  const { leftItems, rightItems, rowCount } = useMemo(() => {
    const left = items.filter(item => item.side === 'left');
    const right = items.filter(item => item.side === 'right');
    return {
      leftItems: left,
      rightItems: right,
      rowCount: Math.max(left.length, right.length),
    };
  }, [items]);

  return (
    <div className="flex flex-col">
      {Array.from({ length: rowCount }).map((_, index) => (
        <CompactSocketRow
          key={`${leftItems[index]?.param.id ?? 'left'}-${rightItems[index]?.param.id ?? 'right'}-${index}`}
          left={leftItems[index]}
          right={rightItems[index]}
        />
      ))}
    </div>
  );
});

/**
 * Generic flow node component.
 * Renders any node type based on its definition from the registry.
 */
function FlowNodeComponent({ id, type, data, selected }: FlowNodeProps) {
  const { updateNodeData } = useFlowActions();
  const rawStatus = typeof data._executionStatus === 'string' ? data._executionStatus : 'idle';
  const status = (['idle', 'running', 'completed', 'error'] as const).includes(rawStatus as FlowNodeExecutionSnapshot['status'])
    ? (rawStatus as FlowNodeExecutionSnapshot['status'])
    : 'idle';
  const executionError = typeof data._executionError === 'string' ? data._executionError : undefined;

  const handleParameterChange = useCallback(
    (paramId: string, value: unknown) => {
      updateNodeData(id, paramId, value);
    },
    [id, updateNodeData]
  );

  const definition = getNodeDefinition(type);

  const edges = useStore(
    useCallback((state) => state.edges as FlowEdge[], [])
  );

  const edgeIndex = useMemo(
    () => buildNodeEdgeIndex(edges, id),
    [edges, id]
  );

  const connectedHandles = useMemo(() => {
    const connected = new Set<string>();
    for (const edge of edgeIndex.incoming) {
      if (edge.targetHandle) connected.add(edge.targetHandle);
    }
    for (const edge of edgeIndex.outgoing) {
      if (edge.sourceHandle) connected.add(edge.sourceHandle);
    }
    return connected;
  }, [edgeIndex]);

  const visibleParams = useMemo(
    () => (definition ? definition.parameters.filter(param => shouldRenderParam(param, 'node', edgeIndex)) : []),
    [definition, edgeIndex]
  );

  const paramBlocks = useMemo<ParamBlock[]>(() => {
    if (!definition) return [];
    const blocks: ParamBlock[] = [];
    let compactBuffer: SocketParamItem[] = [];

    for (const param of visibleParams) {
      const isConnected = connectedHandles.has(param.id);
      if (isSocketOnlyParam(param, isConnected)) {
        compactBuffer.push({ param, side: getSocketSide(param) });
        continue;
      }

      if (compactBuffer.length > 0) {
        blocks.push({ kind: 'compact', items: compactBuffer });
        compactBuffer = [];
      }

      blocks.push({ kind: 'normal', param });
    }

    if (compactBuffer.length > 0) {
      blocks.push({ kind: 'compact', items: compactBuffer });
    }

    return blocks;
  }, [definition, visibleParams, connectedHandles]);

  if (!definition) {
    return (
      <div className="bg-destructive/50 border border-destructive rounded p-2 text-xs text-destructive-foreground">
        Unknown node type: {type}
      </div>
    );
  }

  const Icon = getIcon(definition.icon);
  const statusRing = status === 'running'
    ? 'flow-node-glow ring-yellow-500/60'
    : status === 'completed'
      ? 'flow-node-glow ring-emerald-500/50'
      : status === 'error'
        ? 'flow-node-glow ring-red-500/60'
        : '';

  const statusBadge = status === 'running'
    ? (
      <span className="ml-auto text-yellow-500" title={executionError}>
        <Loader2 className="h-4 w-4 animate-spin" />
      </span>
    )
    : status === 'completed'
      ? (
        <span className="ml-auto text-emerald-500" title={executionError}>
          <Check className="h-4 w-4" />
        </span>
      )
      : status === 'error'
        ? (
          <span className="ml-auto text-red-500" title={executionError}>
            <X className="h-4 w-4" />
          </span>
        )
        : null;

  return (
    <div
      className={cn(
        'border rounded-lg bg-card min-w-[180px] max-w-[280px] shadow-lg',
        selected ? 'border-primary' : getCategoryBorderColor(definition.category),
        statusRing
      )}
    >
      <div className={cn(
        getCategoryColor(definition.category),
        'rounded-lg'
      )}>
        <div className='flex items-center gap-1.5 px-2 py-1.5'>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
          <Icon className="h-4 w-4" />
          <span className="text-sm font-medium truncate">{definition.name}</span>
          {status !== 'idle' && statusBadge}
        </div>

        <div className="py-1 bg-card rounded-lg border-t border-border">
          {paramBlocks.map((block, index) => {
            if (block.kind === 'compact') {
              return (
                <CompactSocketGroup
                  key={`compact-${index}`}
                  items={block.items}
                />
              );
            }

            return (
              <ParameterRow
                key={block.param.id}
                param={block.param}
                value={data[block.param.id]}
                isConnected={connectedHandles.has(block.param.id)}
                onParamChange={handleParameterChange}
                nodeId={id}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Get header color based on node category */
function getCategoryColor(category: NodeDefinition['category']): string {
  switch (category) {
    case 'trigger':
      return 'bg-emerald-500/20 text-emerald-950 dark:text-emerald-100';
    case 'llm':
      return 'bg-violet-500/20 text-violet-950 dark:text-violet-100';
    case 'flow':
      return 'bg-rose-500/20 text-rose-950 dark:text-rose-100';
    case 'tools':
      return 'bg-amber-500/20 text-amber-950 dark:text-amber-100';
    case 'data':
      return 'bg-blue-500/20 text-blue-950 dark:text-blue-100';
    case 'integration':
      return 'bg-cyan-500/20 text-cyan-950 dark:text-cyan-100';
    case 'rag':
      return 'bg-lime-500/20 text-lime-950 dark:text-lime-100';
    case 'utility':
      return 'bg-muted';
    default:
      return 'bg-muted';
  }
}

/** Get border color based on node category */
function getCategoryBorderColor(category: NodeDefinition['category']): string {
  switch (category) {
    case 'trigger':
      return 'border-emerald-500/20';
    case 'llm':
      return 'border-violet-500/20';
    case 'flow':
      return 'border-rose-500/20';
    case 'tools':
      return 'border-amber-500/20';
    case 'data':
      return 'border-blue-500/20';
    case 'integration':
      return 'border-cyan-500/20';
    case 'rag':
      return 'border-lime-500/20';
    case 'utility':
      return 'border-border';
    default:
      return 'border-border';
  }
}

export const FlowNode = memo(FlowNodeComponent);
