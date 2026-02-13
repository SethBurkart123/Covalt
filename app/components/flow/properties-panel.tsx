'use client';

import { useCallback, useMemo, memo, type ComponentType } from 'react';
import { useNodesData, useStore } from '@xyflow/react';
import * as Icons from 'lucide-react';
import type { FlowEdge, Parameter } from '@/lib/flow';
import { getNodeDefinition, useSelection, useFlowActions } from '@/lib/flow';
import { ParameterControl } from './controls';
import { buildNodeEdgeIndex, shouldRenderParam } from './parameter-visibility';
import { cn } from '@/lib/utils';

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

  if (!effectiveNodeId || !selectedNodeData?.type) {
    return null;
  }

  const definition = getNodeDefinition(selectedNodeData.type);

  if (!definition) {
    return (
      <div className="p-4 text-destructive text-sm">
        Unknown node type: {selectedNodeData.type}
      </div>
    );
  }

  const Icon = getIcon(definition.icon);

  const panelParams = definition.parameters.filter(p => {
    if (p.mode !== 'constant' && p.mode !== 'hybrid') return false;
    return shouldRenderParam(p, 'inspector', edgeIndex);
  });

  const showCard = variant === 'card';

  return (
    <div
      className={cn(
        'flex flex-col min-h-0',
        showCard && 'bg-card/95 backdrop-blur-sm border border-border rounded-lg shadow-xl max-h-[calc(100vh-8rem)] overflow-hidden',
        className
      )}
    >
      <div className={cn('flex items-center gap-2 border-b border-border', showCard ? 'px-4 py-3' : 'px-0 pb-3')}>
        <Icon className="h-5 w-5 text-muted-foreground" />
        <div>
          <h3 className="font-medium text-sm text-foreground">{definition.name}</h3>
          {definition.description && (
            <p className="text-xs text-muted-foreground">{definition.description}</p>
          )}
        </div>
      </div>

      <div className={cn('flex-1 overflow-y-auto space-y-4', showCard ? 'p-4' : 'pt-4 pr-1')}>
        {panelParams.map(param => (
          <ParameterField
            key={param.id}
            param={param}
            value={selectedNodeData.data[param.id]}
            isConnected={connectedHandles.has(param.id)}
            onParamChange={handleDataChange}
            nodeId={effectiveNodeId}
          />
        ))}

        {panelParams.length === 0 && (
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
}

const ParameterField = memo(function ParameterField({
  param,
  value,
  isConnected,
  onParamChange,
  nodeId,
}: ParameterFieldProps) {
  const handleChange = useCallback((v: unknown) => onParamChange(param.id, v), [param.id, onParamChange]);
  const showControl = (param.mode === 'constant') || (param.mode === 'hybrid' && !isConnected);
  
  return (
    <div className="space-y-1.5">
      {param.type !== 'messages' && (
        <label className="text-xs font-medium text-muted-foreground">
          {param.label}
        </label>
      )}
      {showControl ? (
        <ParameterControl
          param={param}
          value={value}
          onChange={handleChange}
          nodeId={nodeId}
        />
      ) : (
        <div className="text-xs text-muted-foreground italic">
          Connected via graph input.
        </div>
      )}
    </div>
  );
});
