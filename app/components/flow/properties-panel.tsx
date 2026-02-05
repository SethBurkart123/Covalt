'use client';

import { useCallback } from 'react';
import * as Icons from 'lucide-react';
import type { Parameter } from '@/lib/flow';
import { getNodeDefinition, useFlow } from '@/lib/flow';
import { ParameterControl } from './controls';

/** Get a Lucide icon component by name */
function getIcon(name: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const IconComponent = (Icons as any)[name];
  return IconComponent ?? Icons.Circle;
}

/**
 * Properties panel - shows editable properties for the selected node.
 * Consumes selection and node data from FlowContext.
 */
export function PropertiesPanel() {
  const { selectedNodeId, selectedNode, updateNodeData } = useFlow();

  const handleDataChange = useCallback(
    (paramId: string, value: unknown) => {
      if (selectedNodeId) {
        updateNodeData(selectedNodeId, paramId, value);
      }
    },
    [selectedNodeId, updateNodeData]
  );

  // No selection = no panel
  if (!selectedNodeId || !selectedNode) {
    return null;
  }

  const definition = getNodeDefinition(selectedNode.type);

  if (!definition) {
    return (
      <div className="p-4 text-destructive text-sm">
        Unknown node type: {selectedNode.type}
      </div>
    );
  }

  const Icon = getIcon(definition.icon);

  // Get parameters that should show in panel (constant and hybrid modes)
  const panelParams = definition.parameters.filter(
    p => p.mode === 'constant' || p.mode === 'hybrid'
  );

  return (
    <div className="flex flex-col bg-card/95 backdrop-blur-sm border border-border rounded-lg shadow-xl max-h-[calc(100vh-8rem)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Icon className="h-5 w-5 text-muted-foreground" />
        <div>
          <h3 className="font-medium text-sm text-foreground">{definition.name}</h3>
          {definition.description && (
            <p className="text-xs text-muted-foreground">{definition.description}</p>
          )}
        </div>
      </div>

      {/* Parameters */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {panelParams.map(param => (
          <ParameterField
            key={param.id}
            param={param}
            value={selectedNode.data[param.id]}
            onChange={(value) => handleDataChange(param.id, value)}
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
  onChange: (value: unknown) => void;
}

function ParameterField({ param, value, onChange }: ParameterFieldProps) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">
        {param.label}
      </label>
      <ParameterControl
        param={param}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}
