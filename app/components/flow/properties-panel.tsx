'use client';

import { useCallback, useMemo, memo } from 'react';
import { useNodesData, useStore } from '@xyflow/react';
import type { FlowEdge, Parameter, NodeDefinition } from '@/lib/flow';
import { getNodeDefinition, useSelection, useFlowActions } from '@/lib/flow';
import { ParameterControl } from './controls';
import { buildNodeEdgeIndex, shouldRenderParam, shouldRenderParamControl, canRenderParamControl } from './parameter-visibility';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { getBackendBaseUrl } from '@/lib/services/backend-url';
import { getFlowIcon } from './flow-icon';

interface RouteDisplayState {
  label: string;
  idField: string;
  value: string;
  url: string | null;
  canGenerate: boolean;
  emptyValuePlaceholder: string;
  idPrefix: string;
}

interface BuildRouteDisplayStateArgs {
  definition: NodeDefinition | null;
  data: Record<string, unknown>;
  backendBaseUrl: string;
}

function resolveRoutePath(pathTemplate: string, value: string): string {
  return pathTemplate.replace('{id}', encodeURIComponent(value));
}

export function buildRouteDisplayState({
  definition,
  data,
  backendBaseUrl,
}: BuildRouteDisplayStateArgs): RouteDisplayState | null {
  const route = definition?.metadata?.route;
  if (!route) return null;

  const idField = route.idField;
  const idPrefix = route.idPrefix ?? '';
  const rawValue = data[idField];
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  const resolvedPath = value ? resolveRoutePath(route.path, value) : null;

  return {
    label: route.label ?? 'Route URL',
    idField,
    value,
    url: resolvedPath ? `${backendBaseUrl}${resolvedPath}` : null,
    canGenerate: value.length === 0 && idPrefix.length > 0,
    emptyValuePlaceholder: route.emptyValuePlaceholder ?? 'Generate an id first',
    idPrefix,
  };
}

interface PropertiesPanelProps {
  nodeId?: string | null;
  variant?: 'card' | 'flat';
  className?: string;
}

export function PropertiesPanel({ nodeId, variant = 'card', className }: PropertiesPanelProps) {
  const { selectedNodeId } = useSelection();
  const { updateNodeData } = useFlowActions();
  const effectiveNodeId = nodeId ?? selectedNodeId;
  
  // Memoize the array to prevent useNodesData from re-subscribing every render
  const nodeIds = useMemo(() => effectiveNodeId ? [effectiveNodeId] : [], [effectiveNodeId]);
  const [selectedNodeData] = useNodesData(nodeIds);

  const handleDataChange = useCallback(
    (paramId: string, value: unknown) => {
      if (effectiveNodeId) {
        updateNodeData(effectiveNodeId, paramId, value);
      }
    },
    [effectiveNodeId, updateNodeData]
  );

  const edges = useStore(
    useCallback((state) => state.edges as FlowEdge[], [])
  );

  const edgeIndex = useMemo(
    () => effectiveNodeId ? buildNodeEdgeIndex(edges, effectiveNodeId) : { incoming: [], outgoing: [] },
    [edges, effectiveNodeId]
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

  const nodeType = selectedNodeData?.type ?? null;
  const definition = nodeType ? getNodeDefinition(nodeType) ?? null : null;
  const nodeData = useMemo(
    () => (selectedNodeData?.data ?? {}) as Record<string, unknown>,
    [selectedNodeData?.data]
  );
  const backendBaseUrl = useMemo(() => getBackendBaseUrl(), []);

  const routeDisplay = useMemo(
    () =>
      buildRouteDisplayState({
        definition,
        data: nodeData,
        backendBaseUrl,
      }),
    [backendBaseUrl, definition, nodeData]
  );

  const handleCopyRoute = useCallback(() => {
    if (!routeDisplay?.url) return;
    navigator.clipboard?.writeText(routeDisplay.url).catch(() => {});
  }, [routeDisplay]);

  const handleGenerateRouteId = useCallback(() => {
    if (!routeDisplay?.canGenerate || !effectiveNodeId) return;
    const nextId = `${routeDisplay.idPrefix}${Math.random().toString(36).slice(2, 10)}`;
    updateNodeData(effectiveNodeId, routeDisplay.idField, nextId);
  }, [effectiveNodeId, routeDisplay, updateNodeData]);

  if (!effectiveNodeId || !nodeType) {
    return null;
  }

  if (!definition) {
    return (
      <div className="p-4 text-destructive text-sm">
        Unknown node type: {nodeType}
      </div>
    );
  }

  const Icon = getFlowIcon(definition.icon);

  const panelParams = definition.parameters.filter(p => {
    if (!canRenderParamControl(p)) return false;
    return shouldRenderParam(p, 'inspector', edgeIndex, selectedNodeData.data as Record<string, unknown>);
  });

  const showCard = variant === 'card';
  const showHeader = showCard;
  const fullPanelParam =
    panelParams.find(param => param.panelLayout === 'full') ??
    panelParams.find(param => param.type === 'code');
  const standardParams = fullPanelParam
    ? panelParams.filter(param => param !== fullPanelParam)
    : panelParams;

  return (
    <div
      className={cn(
        'flex flex-col min-h-0',
        showCard && 'bg-card/95 backdrop-blur-sm border border-border rounded-lg shadow-xl max-h-[calc(100vh-8rem)] overflow-hidden',
        className
      )}
    >
      {showHeader && (
        <div className={cn('flex items-center gap-2 border-b border-border', showCard ? 'px-4 py-3' : 'px-0 pb-3')}>
          <Icon className="h-5 w-5 text-muted-foreground" />
          <div>
            <h3 className="font-medium text-sm text-foreground">{definition.name}</h3>
            {definition.description && (
              <p className="text-xs text-muted-foreground">{definition.description}</p>
            )}
          </div>
        </div>
      )}

      <div
        className={cn(
          'flex-1 min-h-0',
          fullPanelParam ? 'flex flex-col' : 'overflow-y-auto space-y-4',
          showCard ? (fullPanelParam ? 'p-0' : 'p-4') : (fullPanelParam ? 'p-0' : 'pt-0 pr-1')
        )}
      >
        {standardParams.length > 0 && (
          <div className={cn('space-y-4', fullPanelParam ? 'p-4' : undefined)}>
            {standardParams.map(param => (
              <ParameterField
                key={param.id}
                param={param}
                value={selectedNodeData.data[param.id]}
                isConnected={connectedHandles.has(param.id)}
                onParamChange={handleDataChange}
                nodeId={effectiveNodeId}
              />
            ))}
          </div>
        )}

        {fullPanelParam && (
          <div className="flex-1 min-h-0">
            <ParameterField
              key={fullPanelParam.id}
              param={fullPanelParam}
              value={selectedNodeData.data[fullPanelParam.id]}
              isConnected={connectedHandles.has(fullPanelParam.id)}
              onParamChange={handleDataChange}
              nodeId={effectiveNodeId}
              fullBleed
            />
          </div>
        )}

        {routeDisplay && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{routeDisplay.label}</label>
            <div className="flex items-center gap-2">
              <Input
                value={routeDisplay.url ?? ''}
                readOnly
                placeholder={routeDisplay.emptyValuePlaceholder}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleCopyRoute}
                disabled={!routeDisplay.url}
              >
                Copy
              </Button>
            </div>
            {routeDisplay.canGenerate && (
              <Button type="button" variant="secondary" size="sm" onClick={handleGenerateRouteId}>
                Generate ID
              </Button>
            )}
          </div>
        )}

        {panelParams.length === 0 && !routeDisplay && (
          <p className="text-sm text-muted-foreground italic">
            No configurable properties
          </p>
        )}
      </div>
    </div>
  );
}

interface ParameterFieldProps {
  param: Parameter;
  value: unknown;
  isConnected?: boolean;
  onParamChange: (paramId: string, value: unknown) => void;
  nodeId?: string | null;
  fullBleed?: boolean;
}

const ParameterField = memo(function ParameterField({
  param,
  value,
  isConnected,
  onParamChange,
  nodeId,
  fullBleed = false,
}: ParameterFieldProps) {
  const handleChange = useCallback((v: unknown) => onParamChange(param.id, v), [param.id, onParamChange]);
  const showControl = shouldRenderParamControl(param, Boolean(isConnected));
  
  return (
    <div className={cn(fullBleed ? 'h-full' : 'space-y-1.5')}>
      {!fullBleed && param.type !== 'messages' && (
        <label className="text-xs font-medium text-muted-foreground">
          {param.label}
        </label>
      )}
      {showControl ? (
        <div className={cn(fullBleed && 'h-full')}>
          <ParameterControl
            param={param}
            value={value}
            onChange={handleChange}
            nodeId={nodeId}
          />
        </div>
      ) : (
        <div className="text-xs text-muted-foreground italic">
          Connected via graph input.
        </div>
      )}
    </div>
  );
});
