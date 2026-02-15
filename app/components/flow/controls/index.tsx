'use client';

import { memo, type ComponentType } from 'react';
import type { Parameter, ParameterType } from '@/lib/flow';
import { FloatControl } from './float';
import { StringControl } from './string';
import { BooleanControl } from './boolean';
import { EnumControl } from './enum';
import { TextAreaControl } from './text-area';
import { CodeControl } from './code';
import { MessagesControl } from './messages';
import { ModelPicker } from './model-picker';
import { McpServerPicker } from './mcp-server-picker';
import { ToolsetPicker } from './toolset-picker';
import { JsonSchemaControl } from './json-schema';

/** Props that all control components receive */
export interface ControlProps {
  param: Parameter;
  value: unknown;
  onChange: (value: unknown) => void;
  compact?: boolean;
  nodeId?: string | null;
}

type AnyControl = ComponentType<ControlProps>;

/** Registry mapping parameter types to control components */
const CONTROL_REGISTRY: Partial<Record<ParameterType, AnyControl>> = {
  float: FloatControl as AnyControl,
  int: FloatControl as AnyControl,
  string: StringControl as AnyControl,
  boolean: BooleanControl as AnyControl,
  enum: EnumControl as AnyControl,
  'text-area': TextAreaControl as AnyControl,
  code: CodeControl as AnyControl,
  messages: MessagesControl as AnyControl,
  model: ModelPicker as AnyControl,
  'mcp-server': McpServerPicker as AnyControl,
  toolset: ToolsetPicker as AnyControl,
  json: JsonSchemaControl as AnyControl,
};

/** Get the control component for a parameter type */
export function getControlComponent(type: ParameterType): AnyControl | null {
  return CONTROL_REGISTRY[type] ?? null;
}

/**
 * Generic control renderer - picks the right component based on parameter type.
 * Memoized to prevent re-renders when parent updates but props are unchanged.
 */
export const ParameterControl = memo(function ParameterControl({ param, value, onChange, compact, nodeId }: ControlProps) {
  const Control = getControlComponent(param.type);
  
  if (!Control) {
    return (
      <span className="text-xs text-zinc-500 italic">
        No control for {param.type}
      </span>
    );
  }
  
  return <Control param={param} value={value} onChange={onChange} compact={compact} nodeId={nodeId} />;
});

// Re-export individual controls
export { FloatControl } from './float';
export { StringControl } from './string';
export { BooleanControl } from './boolean';
export { EnumControl } from './enum';
export { TextAreaControl } from './text-area';
export { CodeControl } from './code';
export { MessagesControl } from './messages';
export { ModelPicker } from './model-picker';
export { McpServerPicker } from './mcp-server-picker';
export { ToolsetPicker } from './toolset-picker';
export { JsonSchemaControl } from './json-schema';
