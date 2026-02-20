'use client';

import { useCallback, useMemo, memo, type ComponentType } from 'react';
import { useNodesData, useStore } from '@xyflow/react';
import * as Icons from 'lucide-react';
import type { FlowEdge, Parameter } from '@/lib/flow';
import { getNodeDefinition, useSelection, useFlowActions } from '@/lib/flow';
import { ParameterControl } from './controls';
import { buildNodeEdgeIndex, shouldRenderParam } from './parameter-visibility';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { getBackendBaseUrl } from '@/lib/services/backend-url';

function getIcon(name: string) {
  const IconComponent = (Icons as unknown as Record<string, ComponentType<{ className?: string }>>)[name];
  return IconComponent ?? Icons.Circle;
}

/**
 * Properties panel - shows editable properties for the selected node.
 * Consumes selection and node data from FlowContext.
 */
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
  const definition = nodeType ? getNodeDefinition(nodeType) : null;
  const hookId = selectedNodeData?.data?.hookId;
  const routeId = selectedNodeData?.data?.routeId;
  const backendBaseUrl = useMemo(() => getBackendBaseUrl(), []);
  const webhookUrl = useMemo(() => {
    if (definition?.id !== 'webhook-trigger') return null;
    if (typeof hookId !== 'string' || !hookId.trim()) return null;
    return `${backendBaseUrl}/webhooks/${hookId}`;
  }, [backendBaseUrl, definition?.id, hookId]);

  const handleCopyWebhook = useCallback(() => {
    if (!webhookUrl) return;
    navigator.clipboard?.writeText(webhookUrl).catch(() => {});
  }, [webhookUrl]);

  const handleGenerateHookId = useCallback(() => {
    if (definition?.id !== 'webhook-trigger' || !effectiveNodeId) return;
    const nextId = `hook_${Math.random().toString(36).slice(2, 10)}`;
    updateNodeData(effectiveNodeId, 'hookId', nextId);
  }, [definition?.id, effectiveNodeId, updateNodeData]);

  const showRouteId = useMemo(() => {
    if (!definition) return false;
    const hasParam = definition.parameters.some(param => param.id === 'routeId');
    return hasParam || typeof routeId === 'string';
  }, [definition, routeId]);

  const nodeRouteUrl = useMemo(() => {
    if (!showRouteId) return null;
    if (typeof routeId !== 'string' || !routeId.trim()) return null;
    const resolvedNodeType = definition?.id ?? nodeType;
    if (!resolvedNodeType) return null;
    return `${backendBaseUrl}/nodes/${resolvedNodeType}/${routeId}`;
  }, [backendBaseUrl, definition?.id, nodeType, routeId, showRouteId]);

  const handleCopyNodeRoute = useCallback(() => {
    if (!nodeRouteUrl) return;
    navigator.clipboard?.writeText(nodeRouteUrl).catch(() => {});
  }, [nodeRouteUrl]);

  const handleGenerateRouteId = useCallback(() => {
    if (!showRouteId || !effectiveNodeId) return;
    const nextId = `route_${Math.random().toString(36).slice(2, 10)}`;
    updateNodeData(effectiveNodeId, 'routeId', nextId);
  }, [effectiveNodeId, showRouteId, updateNodeData]);

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

  const Icon = getIcon(definition.icon);

  const panelParams = definition.parameters.filter(p => {
    if (p.mode !== 'constant' && p.mode !== 'hybrid') return false;
    return shouldRenderParam(p, 'inspector', edgeIndex);
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

        {definition.id === 'webhook-trigger' && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Webhook URL</label>
            <div className="flex items-center gap-2">
              <Input value={webhookUrl ?? ''} readOnly placeholder="Generate a hook id first" />
              <Button type="button" variant="secondary" size="sm" onClick={handleCopyWebhook} disabled={!webhookUrl}>
                Copy
              </Button>
            </div>
            {(!hookId || (typeof hookId === 'string' && !hookId.trim())) && (
              <Button type="button" variant="secondary" size="sm" onClick={handleGenerateHookId}>
                Generate Hook ID
              </Button>
            )}
          </div>
        )}

        {showRouteId && definition.id !== 'webhook-trigger' && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Node Route URL</label>
            <div className="flex items-center gap-2">
              <Input value={nodeRouteUrl ?? ''} readOnly placeholder="Generate a route id first" />
              <Button type="button" variant="secondary" size="sm" onClick={handleCopyNodeRoute} disabled={!nodeRouteUrl}>
                Copy
              </Button>
            </div>
            {(!routeId || (typeof routeId === 'string' && !routeId.trim())) && (
              <Button type="button" variant="secondary" size="sm" onClick={handleGenerateRouteId}>
                Generate Route ID
              </Button>
            )}
          </div>
        )}

        {panelParams.length === 0 && !webhookUrl && !nodeRouteUrl && definition.id !== 'webhook-trigger' && (
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
  const showControl = (param.mode === 'constant') || (param.mode === 'hybrid' && !isConnected);
  
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
