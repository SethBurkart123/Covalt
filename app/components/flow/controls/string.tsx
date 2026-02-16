'use client';

import type { ControlProps } from './';
import { TemplateEditor } from '../template-editor';

interface StringControlProps extends Omit<ControlProps, 'onChange'> {
  value: string | undefined;
  onChange: (value: string) => void;
  nodeId?: string | null;
}

export function StringControl({ param, value, onChange, compact, nodeId }: StringControlProps) {
  const p = param as { default?: string; placeholder?: string };
  const currentValue = value ?? p.default ?? '';

  return (
    <TemplateEditor
      value={currentValue}
      onChange={onChange}
      placeholder={p.placeholder}
      multiline={false}
      compact={compact}
      nodeId={nodeId}
    />
  );
}
