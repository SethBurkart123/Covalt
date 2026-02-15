'use client';

import {
  useMemo,
  useState,
  useCallback,
  useEffect,
  type DragEvent,
  type MouseEvent,
  type ComponentType,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, CircleDot, Database, FastForward, Loader2, Pin, Play, Search, X } from 'lucide-react';
import * as Icons from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { getNodeDefinition, useFlowState } from '@/lib/flow';
import { PropertiesPanel } from './properties-panel';
import type {
  FlowNodeExecutionSnapshot,
} from '@/contexts/agent-test-chat-context';
import { useFlowExecution } from '@/contexts/flow-execution-context';
import { useFlowRunner } from '@/lib/flow/use-flow-runner';
import {
  buildInputExpression,
  buildNodeExpression,
  buildTriggerExpression,
  formatPreview,
  formatSchemaPreview,
  getNodeName,
  isRecord,
  pickPrimaryOutput,
  sampleArrayValue,
  valueType,
} from './flow-data-utils';
import { TEMPLATE_DRAG_ACTIVE_CLASS } from './template-editor/template-editor-constants';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

type InspectorView = 'schema' | 'json';

interface SchemaNode {
  id: string;
  name: string;
  path: string;
  type: string;
  value: unknown;
  children: SchemaNode[];
}

interface UpstreamEntry {
  nodeId: string;
  nodeName: string;
  status: FlowNodeExecutionSnapshot['status'];
  value: unknown;
  schemaNodes: SchemaNode[];
  outputType: string | null;
}

interface NodeInspectorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodeId: string | null;
}

function toJsonText(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function EventBadge({ status, className }: { status: FlowNodeExecutionSnapshot['status'], className?: string }) {
  const icon = status === 'running'
    ? <Loader2 className="size-4 animate-spin" />
    : status === 'completed'
      ? <Check className="size-4" />
      : status === 'error'
        ? <X className="size-4" />
        : <CircleDot className="size-4" />;

  return (
    <span
      title={status}
      className={cn(
        'inline-flex items-center justify-center text-muted-foreground', className,
        status === 'completed' && 'text-primary',
        status === 'running' && 'text-accent-foreground',
        status === 'error' && 'text-destructive',
        status === 'idle' && 'text-muted-foreground'
      )}
    >
      {icon}
    </span>
  );
}

function ViewTabs({
  value,
  onChange,
}: {
  value: InspectorView;
  onChange: (value: InspectorView) => void;
}) {
  const tabs: InspectorView[] = ['schema', 'json'];
  return (
    <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/60">
      {tabs.map(tab => (
        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          className={cn(
            'px-2.5 py-1 text-xs rounded-md capitalize transition-colors',
            value === tab ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

function getIcon(name: string) {
  const IconComponent = (Icons as unknown as Record<string, ComponentType<{ className?: string }>>)[name];
  return IconComponent ?? Icons.Circle;
}

function RunMenuButton({
  onExecute,
  onRunFrom,
  isRunning,
  className,
}: {
  onExecute: () => void;
  onRunFrom: () => void;
  isRunning: boolean;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const handleExecute = useCallback(
    (event?: MouseEvent<HTMLElement>) => {
      event?.stopPropagation();
      setIsOpen(false);
      onExecute();
    },
    [onExecute]
  );

  const handleRunFrom = useCallback(
    (event?: MouseEvent<HTMLElement>) => {
      event?.stopPropagation();
      setIsOpen(false);
      onRunFrom();
    },
    [onRunFrom]
  );

  const handleContextMenu = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsOpen(true);
  }, []);

  return (
    <DropdownMenu
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) setIsOpen(false);
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'h-8 w-8 rounded-md border border-transparent text-muted-foreground hover:text-foreground hover:border-border transition-colors',
            isRunning && 'opacity-50 pointer-events-none',
            className
          )}
          title="Execute node"
          onClick={handleExecute}
          onContextMenu={handleContextMenu}
          disabled={isRunning}
        >
          <Play className="h-4 w-4 mx-auto" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[150px] z-[200]">
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
  );
}

function buildSchemaNodes(value: unknown): SchemaNode[] {
  if (value === undefined) return [];

  if (Array.isArray(value)) {
    return [createSchemaNode('(root)', '', value, buildArrayChildren(value, ''))];
  }

  if (!isRecord(value)) {
    return [createSchemaNode('(root)', '', value, [])];
  }

  return buildSchemaTree(value, '');
}

function buildSchemaTree(value: Record<string, unknown>, prefix: string): SchemaNode[] {
  return Object.entries(value).map(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const children = Array.isArray(child)
      ? buildArrayChildren(child, path)
      : isRecord(child)
        ? buildSchemaTree(child, path)
        : [];
    return createSchemaNode(key, path, child, children);
  });
}

function buildArrayChildren(value: unknown[], path: string): SchemaNode[] {
  const sample = sampleArrayValue(value);
  if (sample === undefined) return [];

  const indexLabel = '[0]';
  const indexPath = path ? `${path}[0]` : '[0]';
  const children = Array.isArray(sample)
    ? buildArrayChildren(sample, indexPath)
    : isRecord(sample)
      ? buildSchemaTree(sample, indexPath)
      : [];
  return [createSchemaNode(indexLabel, indexPath, sample, children)];
}

function createSchemaNode(
  name: string,
  path: string,
  value: unknown,
  children: SchemaNode[]
): SchemaNode {
  return {
    id: path || name || '(root)',
    name: name || '(root)',
    path,
    type: valueType(value),
    value,
    children,
  };
}

function filterSchemaNodes(nodes: SchemaNode[], query: string): SchemaNode[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return nodes;

  return nodes.flatMap(node => {
    const childMatches = filterSchemaNodes(node.children, query);
    const matches = schemaNodeMatches(node, trimmed);
    if (!matches && childMatches.length === 0) return [];
    return [{ ...node, children: childMatches }];
  });
}

function schemaNodeMatches(node: SchemaNode, query: string): boolean {
  const preview = formatPreview(node.value);
  return [node.name, node.path, node.type, preview].some(value =>
    value.toLowerCase().includes(query)
  );
}

function getRowPreview(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  return '';
}

function OutputTree({
  nodes,
  collapsedPreviews,
  onTogglePreview,
}: {
  nodes: SchemaNode[];
  collapsedPreviews: Set<string>;
  onTogglePreview: (key: string) => void;
}) {
  return (
    <div className="space-y-1">
      {nodes.map(node => (
        <OutputTreeRow
          key={node.id}
          node={node}
          depth={0}
          collapsedPreviews={collapsedPreviews}
          onTogglePreview={onTogglePreview}
        />
      ))}
    </div>
  );
}

function OutputTreeRow({
  node,
  depth,
  collapsedPreviews,
  onTogglePreview,
}: {
  node: SchemaNode;
  depth: number;
  collapsedPreviews: Set<string>;
  onTogglePreview: (key: string) => void;
}) {
  const key = node.path || '(root)';
  const preview = getRowPreview(node.value);
  const isCollapsed = collapsedPreviews.has(key);

  return (
    <div>
      <div
        className="group flex items-start gap-2 rounded-md px-2 py-1 hover:bg-muted/40"
        style={{ paddingLeft: depth * 10 + 8 }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-foreground truncate">{node.name || '(root)'}</span>
            <span className="text-[10px] uppercase text-muted-foreground">{node.type}</span>
          </div>
          {preview ? (
            <button
              type="button"
              onClick={() => onTogglePreview(key)}
              title={isCollapsed ? 'Show full preview' : 'Collapse preview'}
              className={cn(
                'mt-1 text-left text-[11px] text-muted-foreground/80 whitespace-pre-wrap bg-transparent border-0 p-0',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40',
                isCollapsed && 'preview-ellipsis'
              )}
            >
              {preview}
            </button>
          ) : null}
        </div>
      </div>
      {node.children.length > 0 && (
        <div className="ml-2 pl-3 border-l border-border">
          {node.children.map(child => (
            <OutputTreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              collapsedPreviews={collapsedPreviews}
              onTogglePreview={onTogglePreview}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SchemaTree({
  nodes,
  expressionForPath,
}: {
  nodes: SchemaNode[];
  expressionForPath: (path: string) => string;
}) {
  return (
    <div className="space-y-1">
      {nodes.map(node => (
        <SchemaTreeRow
          key={node.id}
          node={node}
          depth={0}
          expressionForPath={expressionForPath}
        />
      ))}
    </div>
  );
}

function SchemaTreeRow({
  node,
  depth,
  expressionForPath,
}: {
  node: SchemaNode;
  depth: number;
  expressionForPath: (path: string) => string;
}) {
  const expression = expressionForPath(node.path);
  const preview =
    node.type === 'array' || node.children.length === 0 ? formatSchemaPreview(node.value) : '';
  const onDragStart = useCallback((event: DragEvent<HTMLSpanElement>) => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('text/plain', expression);
    event.dataTransfer.setDragImage(createDragImage(expression, event.currentTarget), 8, 8);
    document.body.classList.add(TEMPLATE_DRAG_ACTIVE_CLASS);
  }, [expression]);

  return (
    <div>
      <div
        title={expression}
        className="group flex items-center gap-2 rounded-md px-2 py-1 cursor-grab active:cursor-grabbing hover:bg-muted/40"
        style={{ paddingLeft: depth * 7 + 8 }}
      >
        <span
          draggable
          onDragStart={onDragStart}
          onDragEnd={cleanupDragImage}
          onMouseDown={(event) => event.stopPropagation()}
          className="inline-flex items-center rounded-full border border-border/70 bg-background/80 px-2 py-0.5 text-[11px] font-medium text-foreground cursor-grab active:cursor-grabbing"
        >
          {node.name || '(root)'}
        </span>
        <span className="text-[10px] uppercase text-muted-foreground">{node.type}</span>
        {preview ? (
          <span className="text-[11px] text-muted-foreground preview-clamp whitespace-pre-wrap">
            {preview}
          </span>
        ) : null}
      </div>
      {node.children.length > 0 && (
        <div className="ml-2 pl-3 border-l border-border">
          {node.children.map(child => (
            <SchemaTreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expressionForPath={expressionForPath}
            />
          ))}
        </div>
      )}
    </div>
  );
}

let dragImageElement: HTMLDivElement | null = null;

function createDragImage(text: string, source?: HTMLElement | null) {
  if (dragImageElement) return dragImageElement;
  const element = document.createElement('div');
  element.style.position = 'fixed';
  element.style.top = '-9999px';
  element.style.left = '-9999px';
  element.style.padding = '2px 8px';
  element.style.borderRadius = '9999px';
  if (source) {
    const styles = getComputedStyle(source);
    element.style.borderColor = styles.borderColor;
    element.style.borderStyle = styles.borderStyle;
    element.style.borderWidth = styles.borderWidth;
    element.style.backgroundColor = styles.backgroundColor;
    element.style.color = styles.color;
  } else {
    element.style.border = '1px solid hsl(var(--primary) / 0.3)';
    element.style.background = 'hsl(var(--primary) / 0.1)';
    element.style.color = 'hsl(var(--primary) / 1)';
  }
  element.style.opacity = '1';
  element.style.boxShadow = '0 6px 18px hsl(var(--primary) / 0.2)';
  element.style.fontSize = '11px';
  element.style.fontWeight = '600';
  element.style.whiteSpace = 'nowrap';
  element.style.pointerEvents = 'none';
  element.textContent = text;
  document.body.appendChild(element);
  dragImageElement = element;
  return element;
}

function cleanupDragImage() {
  if (!dragImageElement) return;
  dragImageElement.remove();
  dragImageElement = null;
  document.body.classList.remove(TEMPLATE_DRAG_ACTIVE_CLASS);
}

function DataSection({
  title,
  subtitle,
  schemaNodes,
  view,
  jsonValue,
  expressionForPath,
  status,
}: {
  title: string;
  subtitle?: string;
  schemaNodes: SchemaNode[];
  view: InspectorView;
  jsonValue: unknown;
  expressionForPath: (path: string) => string;
  status?: FlowNodeExecutionSnapshot['status'];
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0 flex items-center gap-2">
          {status && (
            <CircleDot
              className={cn(
                'size-3 shrink-0',
                status === 'completed' && 'text-primary',
                status === 'running' && 'text-accent-foreground',
                status === 'error' && 'text-destructive',
                status === 'idle' && 'text-muted-foreground'
              )}
            />
          )}
          <p className="text-xs font-medium truncate text-foreground">{title}</p>
          {subtitle && <p className="text-[11px] text-muted-foreground truncate">({subtitle})</p>}
        </div>
      </div>

      {view === 'json' ? (
        <pre className="text-[11px] text-foreground/85 p-3 whitespace-pre-wrap break-all">
          {toJsonText(jsonValue) || 'No data'}
        </pre>
      ) : (
        <div className="p-2">
          {schemaNodes.length === 0 ? (
            <p className="text-xs text-muted-foreground px-1 py-2">No fields available</p>
          ) : (
            <SchemaTree nodes={schemaNodes} expressionForPath={expressionForPath} />
          )}
        </div>
      )}
    </div>
  );
}

export function NodeInspectorDialog({
  open,
  onOpenChange,
  nodeId,
}: NodeInspectorDialogProps) {
  const { nodes, edges } = useFlowState();
  const { executionByNode, pinnedByNodeId, togglePinned } = useFlowExecution();
  const { requestRun, isRunning } = useFlowRunner();
  const [leftView, setLeftView] = useState<InspectorView>('schema');
  const [rightView, setRightView] = useState<InspectorView>('schema');
  const [search, setSearch] = useState('');
  const [collapsedPreviews, setCollapsedPreviews] = useState<Set<string>>(() => new Set());
  const [mounted, setMounted] = useState(false);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };

    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = priorOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [close, open]);

  useEffect(() => {
    setCollapsedPreviews(new Set());
  }, [nodeId]);

  const togglePreview = useCallback((key: string) => {
    setCollapsedPreviews(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const nodesById = useMemo(() => {
    const map = new Map<string, typeof nodes[number]>();
    for (const node of nodes) {
      map.set(node.id, node);
    }
    return map;
  }, [nodes]);

  const selectedNode = useMemo(
    () => (nodeId ? nodesById.get(nodeId) ?? null : null),
    [nodeId, nodesById]
  );

  const flowEdges = useMemo(
    () => edges.filter(edge => edge.data.channel === 'flow'),
    [edges]
  );

  const upstreamIds = useMemo(() => {
    if (!nodeId) return [];

    const seen = new Set<string>();
    const queue = [nodeId];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;

      for (const edge of flowEdges) {
        if (edge.target !== current || !edge.source) continue;
        if (seen.has(edge.source)) continue;
        seen.add(edge.source);
        queue.push(edge.source);
      }
    }

    return nodes
      .filter(node => seen.has(node.id))
      .map(node => node.id);
  }, [flowEdges, nodeId, nodes]);

  const triggerSource = useMemo(() => {
    for (const id of upstreamIds) {
      const node = nodesById.get(id);
      if (node?.type === 'chat-start') return node;
    }

    for (const node of nodes) {
      if (node.type === 'chat-start') return node;
    }

    return null;
  }, [nodes, nodesById, upstreamIds]);

  const directInputSource = useMemo(() => {
    if (!nodeId) return null;
    const inputEdge = flowEdges.find(edge => edge.target === nodeId && (edge.targetHandle ?? 'input') === 'input');
    if (!inputEdge?.source) return null;
    return nodesById.get(inputEdge.source) ?? null;
  }, [flowEdges, nodeId, nodesById]);

  const directInputSnapshot = useMemo(() => {
    if (!directInputSource) return null;
    return executionByNode[directInputSource.id] ?? null;
  }, [directInputSource, executionByNode]);

  const directInputOutput = useMemo(() => pickPrimaryOutput(directInputSnapshot ?? undefined), [directInputSnapshot]);

  const triggerSnapshot = useMemo(() => {
    if (!triggerSource) return null;
    return executionByNode[triggerSource.id] ?? null;
  }, [executionByNode, triggerSource]);

  const triggerOutput = useMemo(() => pickPrimaryOutput(triggerSnapshot ?? undefined), [triggerSnapshot]);

  const upstreamEntries = useMemo<UpstreamEntry[]>(() => {
    return upstreamIds
      .map(id => {
        const node = nodesById.get(id);
        if (!node) return null;

        const snapshot = executionByNode[id];
        const output = pickPrimaryOutput(snapshot);
        const schemaNodes = filterSchemaNodes(buildSchemaNodes(output.value), search);

        return {
          nodeId: id,
          nodeName: getNodeName(node),
          status: snapshot?.status ?? 'idle',
          value: output.value,
          schemaNodes,
          outputType: output.type,
        };
      })
      .filter((entry): entry is UpstreamEntry => entry !== null);
  }, [executionByNode, nodesById, search, upstreamIds]);

  const currentSnapshot = nodeId ? executionByNode[nodeId] : undefined;
  const currentOutput = useMemo(() => pickPrimaryOutput(currentSnapshot), [currentSnapshot]);
  const currentSchemaNodes = useMemo(
    () => (currentOutput.value === undefined ? [] : buildSchemaNodes(currentOutput.value)),
    [currentOutput.value]
  );

  const definition = useMemo(
    () => (selectedNode ? getNodeDefinition(selectedNode.type) : null),
    [selectedNode]
  );
  const HeaderIcon = useMemo(
    () => getIcon(definition?.icon ?? 'Circle'),
    [definition?.icon]
  );
  const currentNodeName = selectedNode ? getNodeName(selectedNode) : 'Node';
  const currentNodeDescription = definition?.description?.trim() ?? '';
  const isPinned = nodeId ? Boolean(pinnedByNodeId[nodeId]) : false;
  const hasFullPanel = useMemo(() => {
    if (!definition) return false;
    if (definition.id === 'code') return true;
    return definition.parameters.some(
      param => param.panelLayout === 'full' && (param.renderScope ?? 'both') !== 'node'
    );
  }, [definition]);

  const handleExecute = useCallback(() => {
    if (!nodeId) return;
    requestRun(nodeId, 'execute');
  }, [nodeId, requestRun]);

  const handleRunFrom = useCallback(() => {
    if (!nodeId) return;
    requestRun(nodeId, 'runFrom');
  }, [nodeId, requestRun]);

  const handleTogglePin = useCallback(() => {
    if (!nodeId) return;
    togglePinned(nodeId);
  }, [nodeId, togglePinned]);

  if (!mounted || !open || !nodeId || !selectedNode) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[100]" data-node-inspector="true">
      <div
        className="absolute inset-0 bg-background/70 backdrop-blur-[2px]"
        onClick={close}
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal="true"
        className="absolute inset-3 lg:inset-4 overflow-visible px-12"
        onClick={e => e.stopPropagation()}
      >
        <div className="hidden lg:block h-full min-h-0 relative px-6 py-4 overflow-visible">
          <section className="absolute left-[-1.5%] top-9 bottom-9 w-[29.75%] rounded-l-2xl rounded-r-none border border-border bg-card/95 shadow-2xl overflow-hidden z-10">
            <div className="h-full min-h-0 flex flex-col">
              <div className="px-4 py-3 border-b border-border space-y-2 bg-card/85">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Database className="size-4 text-muted-foreground" />
                    Input
                  </div>
                  <ViewTabs value={leftView} onChange={setLeftView} />
                </div>
                <div className="relative">
                  <Search className="size-3.5 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2" />
                  <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search fields and values"
                    className="h-8 text-xs pl-7"
                  />
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 divide-y divide-border">
                <DataSection
                  title="Trigger"
                  subtitle={triggerSource ? `From ${getNodeName(triggerSource)}` : 'No chat-start data'}
                  schemaNodes={filterSchemaNodes(buildSchemaNodes(triggerOutput.value), search)}
                  view={leftView}
                  jsonValue={triggerOutput.value}
                  expressionForPath={buildTriggerExpression}
                />

                <DataSection
                  title="Direct input"
                  subtitle={directInputSource ? `From ${getNodeName(directInputSource)}` : 'No connected input node'}
                  schemaNodes={filterSchemaNodes(buildSchemaNodes(directInputOutput.value), search)}
                  view={leftView}
                  jsonValue={directInputOutput.value}
                  expressionForPath={buildInputExpression}
                />

                {upstreamEntries.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-1 py-2">No upstream node data found in last execution.</p>
                ) : (
                  upstreamEntries.map(entry => (
                    <div key={entry.nodeId}>
                      <DataSection
                        title={entry.nodeName}
                        subtitle={entry.outputType ? `${entry.outputType} output` : 'No output'}
                        schemaNodes={entry.schemaNodes}
                        view={leftView}
                        jsonValue={entry.value}
                        expressionForPath={path => buildNodeExpression(entry.nodeName, path)}
                        status={entry.status}
                      />
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>

          <section className="absolute left-[27.75%] right-[27.75%] top-4 bottom-5 rounded-2xl border border-border bg-background shadow-2xl overflow-hidden z-20">
            <div className="h-full min-h-0 flex flex-col">
              <div className="p-4 border-b border-border bg-card/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex items-center gap-3">
                    <span className="inline-flex size-10 items-center justify-center rounded-xl border border-border/60 bg-muted/50">
                      <HeaderIcon className="size-5 text-muted-foreground" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold truncate">{currentNodeName}</h2>
                      {currentNodeDescription ? (
                        <p className="text-xs text-muted-foreground truncate">{currentNodeDescription}</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <EventBadge status={currentSnapshot?.status ?? 'idle'} />
                    <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/70 p-0.5">
                      <button
                        type="button"
                        className={cn(
                          'h-8 w-8 rounded-md border border-transparent transition-colors text-muted-foreground hover:text-foreground hover:border-border',
                          isPinned && 'text-amber-500 hover:text-amber-500'
                        )}
                        title={isPinned ? 'Unpin data' : 'Pin data'}
                        onClick={handleTogglePin}
                      >
                        <Pin className="h-4 w-4 mx-auto" />
                      </button>
                      <RunMenuButton
                        onExecute={handleExecute}
                        onRunFrom={handleRunFrom}
                        isRunning={isRunning}
                        className="bg-primary/10 text-primary hover:text-primary hover:border-primary/30"
                      />
                    </div>
                    <Button variant="ghost" size="icon" onClick={close} title="Close">
                      <X className="size-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className={cn(
                'flex-1 min-h-0',
                hasFullPanel ? 'p-0 overflow-hidden' : 'px-5 py-4 overflow-y-auto'
              )}>
                <PropertiesPanel nodeId={nodeId} variant="flat" className="h-full" />
              </div>
            </div>
          </section>

          <section className="absolute right-[-1.5%] top-9 bottom-9 w-[29.75%] rounded-r-2xl rounded-l-none border border-border bg-card/95 shadow-2xl overflow-hidden z-10">
            <div className="h-full min-h-0 flex flex-col">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 bg-card/85">
                <div className="text-sm font-medium text-foreground">Output</div>
                <ViewTabs value={rightView} onChange={setRightView} />
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-3">
                {currentOutput.value === undefined ? (
                  <div className="h-full flex items-center justify-center text-center">
                    <p className="text-xs text-muted-foreground">No output data in last execution.</p>
                  </div>
                ) : rightView === 'json' ? (
                  <pre className="text-[11px] text-foreground/85 p-3 rounded-xl border border-border bg-background overflow-auto whitespace-pre-wrap break-all">
                    {toJsonText(currentOutput.value)}
                  </pre>
                ) : (
                  <div className="rounded-xl border border-border bg-card/50 p-2">
                    {currentSchemaNodes.length === 0 ? (
                      <p className="text-xs text-muted-foreground px-1 py-2">No fields available</p>
                    ) : (
                      <OutputTree
                        nodes={currentSchemaNodes}
                        collapsedPreviews={collapsedPreviews}
                        onTogglePreview={togglePreview}
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>

        <div className="lg:hidden absolute inset-3 rounded-2xl border border-border bg-background shadow-2xl overflow-hidden">
          <div className="h-full min-h-0 flex flex-col">
            <header className="px-4 py-3 border-b border-border bg-card/60 flex items-start justify-between gap-3">
              <div className="min-w-0 flex items-center gap-3">
                <span className="inline-flex size-9 items-center justify-center rounded-xl border border-border/60 bg-muted/50">
                  <HeaderIcon className="size-4 text-muted-foreground" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold truncate">{currentNodeName}</h2>
                  {currentNodeDescription ? (
                    <p className="text-xs text-muted-foreground truncate">{currentNodeDescription}</p>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <EventBadge className="w-10" status={currentSnapshot?.status ?? 'idle'} />
                <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/70 p-0.5">
                  <button
                    type="button"
                    className={cn(
                      'h-8 w-8 rounded-md border border-transparent transition-colors text-muted-foreground hover:text-foreground hover:border-border',
                      isPinned && 'text-amber-500 hover:text-amber-500'
                    )}
                    title={isPinned ? 'Unpin data' : 'Pin data'}
                    onClick={handleTogglePin}
                  >
                    <Pin className="h-4 w-4 mx-auto" />
                  </button>
                  <RunMenuButton
                    onExecute={handleExecute}
                    onRunFrom={handleRunFrom}
                    isRunning={isRunning}
                    className="bg-primary/10 text-primary hover:text-primary hover:border-primary/30"
                  />
                </div>
                <Button variant="ghost" size="icon" onClick={close} title="Close">
                  <X className="size-4" />
                </Button>
              </div>
            </header>

            <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto p-3">
              <section className="rounded-xl border border-border bg-card/90 overflow-hidden">
                <div className="px-3 py-2.5 border-b border-border flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Database className="size-4 text-muted-foreground" />
                    Input
                  </div>
                  <ViewTabs value={leftView} onChange={setLeftView} />
                </div>
                <div className="p-3">
                  <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search fields"
                    className="h-8 text-xs"
                  />
                </div>
              </section>

              <section className="rounded-xl border border-border bg-card/90 p-3 min-h-0">
                <PropertiesPanel nodeId={nodeId} variant="flat" className="max-h-[45vh]" />
              </section>

              <section className="rounded-xl border border-border bg-card/90 overflow-hidden">
                <div className="px-3 py-2.5 border-b border-border flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">Output</div>
                  <ViewTabs value={rightView} onChange={setRightView} />
                </div>
                <div className="p-3 text-xs text-muted-foreground">
                  {currentOutput.value === undefined ? 'No output data in last execution.' : toJsonText(currentOutput.value)}
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
