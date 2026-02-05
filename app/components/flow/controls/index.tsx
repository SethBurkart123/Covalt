'use client';

import { memo, type ComponentType } from 'react';
import type { Parameter, ParameterType } from '@/lib/flow';
import { FloatControl } from './float';
import { StringControl } from './string';
import { BooleanControl } from './boolean';
import { EnumControl } from './enum';
import { TextAreaControl } from './text-area';
import { ModelPicker } from './model-picker';
import { McpServerPicker } from './mcp-server-picker';
import { ToolsetPicker } from './toolset-picker';

/** Props that all control components receive */
export interface ControlProps {
  param: Parameter;
  value: unknown;
  onChange: (value: unknown) => void;
  compact?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyControl = ComponentType<any>;

/** Registry mapping parameter types to control components */
const CONTROL_REGISTRY: Partial<Record<ParameterType, AnyControl>> = {
  float: FloatControl,
  int: FloatControl,
  string: StringControl,
  boolean: BooleanControl,
  enum: EnumControl,
  'text-area': TextAreaControl,
  model: ModelPicker,
  'mcp-server': McpServerPicker,
  toolset: ToolsetPicker,
};

/** Get the control component for a parameter type */
export function getControlComponent(type: ParameterType): AnyControl | null {
  return CONTROL_REGISTRY[type] ?? null;
}

/**
 * Generic control renderer - picks the right component based on parameter type.
 * Memoized to prevent re-renders when parent updates but props are unchanged.
 */
export const ParameterControl = memo(function ParameterControl({ param, value, onChange, compact }: ControlProps) {
  const Control = getControlComponent(param.type);
  
  if (!Control) {
    return (
      <span className="text-xs text-zinc-500 italic">
        No control for {param.type}
      </span>
    );
  }
  
  return <Control param={param} value={value} onChange={onChange} compact={compact} />;
});

// Re-export individual controls
export { FloatControl } from './float';
export { StringControl } from './string';
export { BooleanControl } from './boolean';
export { EnumControl } from './enum';
export { TextAreaControl } from './text-area';
export { ModelPicker } from './model-picker';
export { McpServerPicker } from './mcp-server-picker';
export { ToolsetPicker } from './toolset-picker';
