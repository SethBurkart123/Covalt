'use client';

import { memo, useCallback, useEffect, useMemo, useState, type ComponentType, type MouseEvent } from 'react';
import { useStore, type NodeProps } from '@xyflow/react';
import { ChevronDown, Check, X, Loader2, Play, FastForward, Pin } from 'lucide-react';
import * as Icons from 'lucide-react';
import type { NodeDefinition, FlowEdge, Parameter } from '@/lib/flow';
import type { FlowNodeExecutionSnapshot } from '@/contexts/agent-test-chat-context';
import { getNodeDefinition, resolveNodeParameters, useFlowActions, useNodePicker, type FlowNode as FlowNodeType } from '@/lib/flow';
import { ParameterRow } from './parameter-row';
import { buildNodeEdgeIndex, shouldRenderParam } from './parameter-visibility';
import { cn } from '@/lib/utils';
import { Socket } from './socket';
import { useFlowExecution } from '@/contexts/flow-execution-context';
import { useFlowRunner } from '@/lib/flow/use-flow-runner';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

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
  const picker = useNodePicker();
  const { executionByNode, pinnedByNodeId, togglePinned } = useFlowExecution();
  const { requestRun, isRunning } = useFlowRunner();
  const rawStatus = typeof data._executionStatus === 'string' ? data._executionStatus : 'idle';
  const status = (['idle', 'running', 'completed', 'error'] as const).includes(rawStatus as FlowNodeExecutionSnapshot['status'])
    ? (rawStatus as FlowNodeExecutionSnapshot['status'])
    : 'idle';
  const executionError = typeof data._executionError === 'string' ? data._executionError : undefined;
  const isPinned = Boolean(pinnedByNodeId[id]);
  const hasOutputs = Boolean(executionByNode[id]?.outputs);
  const [isRunMenuOpen, setIsRunMenuOpen] = useState(false);

  const handleExecute = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation();
      setIsRunMenuOpen(false);
      requestRun(id, 'execute');
    },
    [id, requestRun]
  );

  const handleRunFrom = useCallback(
    (event?: MouseEvent) => {
      event?.stopPropagation();
      setIsRunMenuOpen(false);
      requestRun(id, 'runFrom');
    },
    [id, requestRun]
  );

  const handleRunContextMenu = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setIsRunMenuOpen(true);
    },
    []
  );

  const handleTogglePin = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation();
      if (!isPinned && !hasOutputs) return;
      togglePinned(id);
    },
    [hasOutputs, id, isPinned, togglePinned]
  );

  useEffect(() => {
    if (!selected) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'p') return;
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable
      ) {
        return;
      }
      if (!isPinned && !hasOutputs) return;
      event.preventDefault();
      togglePinned(id);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasOutputs, id, isPinned, selected, togglePinned]);

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

  const resolvedParams = useMemo(
    () =>
      definition
        ? resolveNodeParameters(
            definition,
            { id, type, position: { x: 0, y: 0 }, data: data as Record<string, unknown> } as FlowNodeType,
            edges
          )
        : [],
    [data, definition, edges, id, type]
  );

  const visibleParams = useMemo(
    () => resolvedParams.filter(param => shouldRenderParam(param, 'node', edgeIndex)),
    [edgeIndex, resolvedParams]
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

  const isPickable = picker.isPickableNode(id, type);

  const statusBadge = status === 'running'
    ? (
      <span className="text-yellow-500" title={executionError}>
        <Loader2 className="h-4 w-4 animate-spin" />
      </span>
    )
    : status === 'completed'
      ? (
        <span className="text-emerald-500" title={executionError}>
          <Check className="h-4 w-4" />
        </span>
      )
      : status === 'error'
        ? (
          <span className="text-red-500" title={executionError}>
            <X className="h-4 w-4" />
          </span>
        )
        : null;

  return (
    <div
      className={cn(
        'relative group border rounded-lg bg-card min-w-[180px] max-w-[280px] shadow-lg',
        selected ? 'border-primary' : getCategoryBorderColor(definition.category),
        statusRing,
        isPickable && 'cursor-crosshair'
      )}
    >
      {isPickable && (
        <div className="pointer-events-none absolute -inset-3 z-10 rounded-2xl border-2 border-primary/40 opacity-0 transition-all duration-150 group-hover:opacity-100 group-hover:shadow-[0_0_0_6px_rgba(59,130,246,0.18)]" />
      )}
      <div className={cn(
        getCategoryColor(definition.category),
        'rounded-lg'
      )}>
        <div className='flex items-center gap-1.5 px-2 py-1.5'>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
          <Icon className="h-4 w-4" />
          <span className="text-sm font-medium truncate">{definition.name}</span>
          <div className="ml-auto flex items-center gap-1.5">
            <DropdownMenu
              open={isRunMenuOpen}
              onOpenChange={(open) => {
                if (!open) setIsRunMenuOpen(false);
              }}
            >
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'h-6 w-6 rounded-md border border-transparent text-muted-foreground hover:text-foreground hover:border-border transition-colors',
                    isRunning && 'opacity-50 pointer-events-none'
                  )}
                  title="Execute node"
                  onClick={handleExecute}
                  onContextMenu={handleRunContextMenu}
                >
                  <Play className="h-3.5 w-3.5 mx-auto" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[150px]">
                <DropdownMenuItem onClick={handleExecute} disabled={isRunning}>
                  <Play className="mr-2 h-3.5 w-3.5" />
                  Execute node
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleRunFrom} disabled={isRunning}>
                  <FastForward className="mr-2 h-3.5 w-3.5" />
                  Run from node
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {isPinned && (
              <button
                type="button"
                className={cn(
                  'h-6 w-6 rounded-md border border-transparent transition-colors text-muted-foreground hover:text-foreground hover:border-border',
                  isPinned && 'text-amber-500 hover:text-amber-500'
                )}
                title="Unpin data"
                onClick={handleTogglePin}
              >
                <Pin className="h-3.5 w-3.5 mx-auto" />
              </button>
            )}
            {status !== 'idle' && statusBadge}
          </div>
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
