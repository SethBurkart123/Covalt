'use client';

import {
  useMemo,
  useState,
  useCallback,
  useEffect,
  type DragEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Braces, CircleDot, Database, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useFlowState } from '@/lib/flow';
import { PropertiesPanel } from './properties-panel';
import type {
  FlowNodeExecutionSnapshot,
} from '@/contexts/agent-test-chat-context';
import {
  buildInputExpression,
  buildNodeExpression,
  collectObjectRows,
  formatPreview,
  formatSchemaPreview,
  getNodeName,
  isRecord,
  pickPrimaryOutput,
  sampleArrayValue,
  valueType,
} from './flow-data-utils';
import { TEMPLATE_DRAG_ACTIVE_CLASS } from './template-editor/template-editor-constants';

type InspectorView = 'schema' | 'json';

interface PathRow {
  path: string;
  value: unknown;
  type: string;
}

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
  lastExecutionByNode: Record<string, FlowNodeExecutionSnapshot>;
}

function toJsonText(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function EventBadge({ status }: { status: FlowNodeExecutionSnapshot['status'] }) {
  return (
    <span
      className={cn(
        'text-[10px] uppercase tracking-wide rounded px-2 py-0.5 border font-medium',
        status === 'completed' && 'bg-primary/10 text-primary border-primary/30',
        status === 'running' && 'bg-accent text-accent-foreground border-border',
        status === 'error' && 'bg-destructive/10 text-destructive border-destructive/30',
        status === 'idle' && 'bg-muted text-muted-foreground border-border'
      )}
    >
      {status}
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
  lastExecutionByNode,
}: NodeInspectorDialogProps) {
  const { nodes, edges } = useFlowState();
  const [leftView, setLeftView] = useState<InspectorView>('schema');
  const [rightView, setRightView] = useState<InspectorView>('schema');
  const [search, setSearch] = useState('');
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
    () => edges.filter(edge => (edge.data?.channel ?? 'flow') === 'flow'),
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

  const directInputSource = useMemo(() => {
    if (!nodeId) return null;
    const inputEdge = flowEdges.find(edge => edge.target === nodeId && (edge.targetHandle ?? 'input') === 'input');
    if (!inputEdge?.source) return null;
    return nodesById.get(inputEdge.source) ?? null;
  }, [flowEdges, nodeId, nodesById]);

  const directInputSnapshot = useMemo(() => {
    if (!directInputSource) return null;
    return lastExecutionByNode[directInputSource.id] ?? null;
  }, [directInputSource, lastExecutionByNode]);

  const directInputOutput = useMemo(() => pickPrimaryOutput(directInputSnapshot ?? undefined), [directInputSnapshot]);

  const upstreamEntries = useMemo<UpstreamEntry[]>(() => {
    return upstreamIds
      .map(id => {
        const node = nodesById.get(id);
        if (!node) return null;

        const snapshot = lastExecutionByNode[id];
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
  }, [lastExecutionByNode, nodesById, search, upstreamIds]);

  const currentSnapshot = nodeId ? lastExecutionByNode[nodeId] : undefined;
  const currentOutput = useMemo(() => pickPrimaryOutput(currentSnapshot), [currentSnapshot]);
  const currentRows = useMemo(
    () => (currentOutput.value === undefined ? [] : collectObjectRows(currentOutput.value)),
    [currentOutput.value]
  );

  const currentNodeName = selectedNode ? getNodeName(selectedNode) : 'Node';

  if (!mounted || !open || !nodeId || !selectedNode) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[100]">
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
              <div className="p-4 border-b border-border bg-card/40 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold truncate">{currentNodeName}</h2>
                    <p className="text-xs text-muted-foreground truncate">{selectedNode.type} · Double-click node editor</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <EventBadge status={currentSnapshot?.status ?? 'idle'} />
                    <Button variant="ghost" size="icon" onClick={close} title="Close">
                      <X className="size-4" />
                    </Button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Braces className="size-4 text-muted-foreground" />
                    Parameters
                  </div>
                  <p className="text-xs text-muted-foreground">Drag expressions from the side wings into fields</p>
                </div>
              </div>

              <div className="flex-1 min-h-0 px-5 py-4 overflow-y-auto">
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
                  <div className="rounded-xl border border-border bg-card/50 overflow-hidden">
                    <div className="grid grid-cols-[1fr_auto] gap-2 px-3 py-2 border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                      <span>Field</span>
                      <span>{rightView === 'schema' ? 'Type' : 'Value'}</span>
                    </div>
                    <div className="max-h-[70vh] overflow-y-auto">
                      {currentRows.map(row => (
                        <div key={row.path || '(root)'} className="grid grid-cols-[1fr_auto] gap-2 px-3 py-2 border-b last:border-b-0 border-border text-xs">
                          <span className="truncate text-foreground">{row.path || '(root)'}</span>
                          <span className="text-muted-foreground max-w-[180px] truncate text-right">
                            {row.type}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>

        <div className="lg:hidden absolute inset-3 rounded-2xl border border-border bg-background shadow-2xl overflow-hidden">
          <div className="h-full min-h-0 flex flex-col">
            <header className="px-4 py-3 border-b border-border bg-card/60 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold truncate">{currentNodeName}</h2>
                <p className="text-xs text-muted-foreground truncate">{selectedNode.type} · Double-click node editor</p>
              </div>

              <div className="flex items-center gap-2">
                <EventBadge status={currentSnapshot?.status ?? 'idle'} />
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
                <div className="flex items-center gap-2 text-sm font-medium mb-3">
                  <Braces className="size-4 text-muted-foreground" />
                  Parameters
                </div>
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
