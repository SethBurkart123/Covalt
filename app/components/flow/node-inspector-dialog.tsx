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
import { getNodeDefinition, useFlowState } from '@/lib/flow';
import { PropertiesPanel } from './properties-panel';
import type {
  FlowNodeExecutionSnapshot,
  FlowOutputPortSnapshot,
} from '@/contexts/agent-test-chat-context';

type InspectorView = 'schema' | 'table' | 'json';

interface PathRow {
  path: string;
  value: unknown;
  type: string;
}

interface UpstreamEntry {
  nodeId: string;
  nodeName: string;
  status: FlowNodeExecutionSnapshot['status'];
  value: unknown;
  rows: PathRow[];
  outputType: string | null;
}

interface NodeInspectorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodeId: string | null;
  lastExecutionByNode: Record<string, FlowNodeExecutionSnapshot>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function valueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function collectObjectRows(value: unknown, prefix = ''): PathRow[] {
  if (!isRecord(value)) {
    return [{ path: prefix, value, type: valueType(value) }];
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    return [{ path: prefix, value, type: 'object' }];
  }

  return entries.flatMap(([key, nestedValue]) => {
    const nextPath = prefix ? `${prefix}.${key}` : key;
    if (isRecord(nestedValue)) {
      return collectObjectRows(nestedValue, nextPath);
    }
    return [{ path: nextPath, value: nestedValue, type: valueType(nestedValue) }];
  });
}

function formatPreview(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return `[${value.length} items]`;
  return '{...}';
}

function escapeLabel(label: string): string {
  return label.replace(/'/g, "\\'");
}

function buildNodeExpression(nodeName: string, path: string): string {
  const escaped = escapeLabel(nodeName);
  if (!path) return `{{ $('${escaped}').item.json }}`;
  return `{{ $('${escaped}').item.json.${path} }}`;
}

function buildInputExpression(path: string): string {
  if (!path) return '{{ input }}';
  return `{{ input.${path} }}`;
}

function toJsonText(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function pickPrimaryOutput(snapshot?: FlowNodeExecutionSnapshot): { type: string | null; value: unknown } {
  if (!snapshot?.outputs) return { type: null, value: undefined };

  const output = snapshot.outputs.output ?? snapshot.outputs.true ?? snapshot.outputs.false;
  if (output) return { type: output.type ?? null, value: output.value };

  const first = Object.values(snapshot.outputs)[0] as FlowOutputPortSnapshot | undefined;
  if (!first) return { type: null, value: undefined };
  return { type: first.type ?? null, value: first.value };
}

function getNodeName(node: { type?: string; data?: Record<string, unknown> }): string {
  const label = node.data?._label;
  if (typeof label === 'string' && label.trim()) return label;

  const definition = getNodeDefinition(node.type || '');
  if (definition) return definition.name;

  return node.type || 'Node';
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

function ExpressionRow({
  label,
  expression,
  preview,
  type,
}: {
  label: string;
  expression: string;
  preview: string;
  type: string;
}) {
  const onDragStart = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('text/plain', expression);
  }, [expression]);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="group rounded-xl border border-border/80 bg-background/80 p-2.5 cursor-grab active:cursor-grabbing hover:border-primary/50 transition-colors"
      title={expression}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs text-foreground truncate">{label || '(root)'}</span>
        <span className="text-[10px] uppercase text-muted-foreground">{type}</span>
      </div>
      <p className="text-[11px] text-muted-foreground truncate">{preview || '(empty)'}</p>
      <p className="mt-1 text-[10px] text-primary truncate opacity-75 group-hover:opacity-100">{expression}</p>
    </div>
  );
}

function ViewTabs({
  value,
  onChange,
}: {
  value: InspectorView;
  onChange: (value: InspectorView) => void;
}) {
  const tabs: InspectorView[] = ['schema', 'table', 'json'];
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

function DataSection({
  title,
  subtitle,
  rows,
  view,
  jsonValue,
  expressionForPath,
}: {
  title: string;
  subtitle?: string;
  rows: PathRow[];
  view: InspectorView;
  jsonValue: unknown;
  expressionForPath: (path: string) => string;
}) {
  return (
    <section className="rounded-xl border border-border bg-card/65 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
        <div className="min-w-0">
          <p className="text-xs font-medium truncate text-foreground">{title}</p>
          {subtitle && <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>}
        </div>
      </div>

      {view === 'json' ? (
        <pre className="text-[11px] text-foreground/85 p-3 overflow-auto max-h-60 whitespace-pre-wrap break-all">
          {toJsonText(jsonValue) || 'No data'}
        </pre>
      ) : (
        <div className="max-h-60 overflow-y-auto p-2 space-y-2">
          {rows.length === 0 ? (
            <p className="text-xs text-muted-foreground px-1 py-2">No fields available</p>
          ) : (
            rows.map(row => (
              <ExpressionRow
                key={`${title}:${row.path || '(root)'}`}
                label={row.path}
                expression={expressionForPath(row.path)}
                preview={view === 'schema' ? row.type : formatPreview(row.value)}
                type={row.type}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}

export function NodeInspectorDialog({
  open,
  onOpenChange,
  nodeId,
  lastExecutionByNode,
}: NodeInspectorDialogProps) {
  const { nodes, edges } = useFlowState();
  const [leftView, setLeftView] = useState<InspectorView>('table');
  const [rightView, setRightView] = useState<InspectorView>('table');
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
        const allRows = output.value === undefined ? [] : collectObjectRows(output.value);
        const filteredRows = allRows.filter(row => {
          if (!search.trim()) return true;
          const q = search.toLowerCase();
          return row.path.toLowerCase().includes(q) || formatPreview(row.value).toLowerCase().includes(q);
        });

        return {
          nodeId: id,
          nodeName: getNodeName(node),
          status: snapshot?.status ?? 'idle',
          value: output.value,
          rows: filteredRows,
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

              <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
                <DataSection
                  title="Direct input"
                  subtitle={directInputSource ? `From ${getNodeName(directInputSource)}` : 'No connected input node'}
                  rows={(directInputOutput.value === undefined ? [] : collectObjectRows(directInputOutput.value)).filter(row => {
                    if (!search.trim()) return true;
                    const q = search.toLowerCase();
                    return row.path.toLowerCase().includes(q) || formatPreview(row.value).toLowerCase().includes(q);
                  })}
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
                        rows={entry.rows}
                        view={leftView}
                        jsonValue={entry.value}
                        expressionForPath={path => buildNodeExpression(entry.nodeName, path)}
                      />
                      <div className="flex items-center gap-2 px-1 pt-1.5">
                        <CircleDot className="size-3 text-muted-foreground" />
                        <EventBadge status={entry.status} />
                      </div>
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
                            {rightView === 'schema' ? row.type : formatPreview(row.value)}
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
