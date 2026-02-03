'use client';

import { memo, useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import { ChevronDown } from 'lucide-react';
import * as Icons from 'lucide-react';
import type { NodeDefinition } from '@/lib/flow';
import { getNodeDefinition } from '@/lib/flow';
import { ParameterRow } from './parameter-row';
import { cn } from '@/lib/utils';

interface FlowNodeData {
  [key: string]: unknown;
}

interface FlowNodeProps extends NodeProps {
  data: FlowNodeData;
  type: string;
}

/** Get a Lucide icon component by name */
function getIcon(name: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const IconComponent = (Icons as any)[name];
  return IconComponent ?? Icons.Circle;
}

/**
 * Generic flow node component.
 * Renders any node type based on its definition from the registry.
 */
function FlowNodeComponent({ id, type, data, selected }: FlowNodeProps) {
  // Handle parameter changes - this will bubble up to canvas state
  // Must be before early returns to satisfy rules of hooks
  const handleParameterChange = useCallback((paramId: string, value: unknown) => {
    // This will be handled by the parent canvas via onNodesChange
    // For now, we can use a custom event or callback pattern
    console.log('Parameter change:', id, paramId, value);
  }, [id]);
  
  const definition = getNodeDefinition(type);
  
  if (!definition) {
    return (
      <div className="bg-destructive/50 border border-destructive rounded p-2 text-xs text-destructive-foreground">
        Unknown node type: {type}
      </div>
    );
  }
  
  const Icon = getIcon(definition.icon);
  
  // Get connected inputs from React Flow (would come from edges)
  // For now, we'll pass an empty set - this will be populated by the canvas
  const connectedInputs = new Set<string>();
  
  return (
    <div
      className={cn(
        'bg-card border rounded-lg min-w-[180px] max-w-[280px] shadow-lg',
        selected ? 'border-primary' : 'border-border'
      )}
    >
      {/* Header */}
      <div className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-t-lg border-b',
        getCategoryColor(definition.category),
        'border-border'
      )}>
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
        <Icon className="h-4 w-4" />
        <span className="text-sm font-medium truncate">{definition.name}</span>
      </div>
      
      {/* Body - render parameters in definition order */}
      <div className="py-1">
        {definition.parameters.map(param => (
          <ParameterRow
            key={param.id}
            param={param}
            value={data[param.id]}
            isConnected={connectedInputs.has(param.id)}
            onChange={(v) => handleParameterChange(param.id, v)}
          />
        ))}
      </div>
    </div>
  );
}

/** Get header color based on node category */
function getCategoryColor(category: NodeDefinition['category']): string {
  switch (category) {
    case 'core':
      return 'bg-primary/20 text-primary-foreground';
    case 'tools':
      return 'bg-amber-500/20 text-amber-950 dark:text-amber-100';
    case 'data':
      return 'bg-blue-500/20 text-blue-950 dark:text-blue-100';
    case 'utility':
      return 'bg-muted';
    default:
      return 'bg-muted';
  }
}

// Memoize to prevent unnecessary re-renders
export const FlowNode = memo(FlowNodeComponent);
