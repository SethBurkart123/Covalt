'use client';

import type { Parameter } from '@/lib/flow';
import { TemplateEditor } from '../template-editor';

interface TextAreaControlProps {
  param: Parameter;
  value: string | undefined;
  onChange: (value: string) => void;
  compact?: boolean;
  nodeId?: string | null;
}

export function TextAreaControl({ param, value, onChange, compact, nodeId }: TextAreaControlProps) {
  const p = param as { default?: string; placeholder?: string; rows?: number };
  const currentValue = value ?? p.default ?? '';

  return (
    <TemplateEditor
      value={currentValue}
      onChange={onChange}
      placeholder={p.placeholder}
      multiline
      compact={compact}
      rows={compact ? 2 : p.rows ?? 3}
      nodeId={nodeId}
    />
  );
}
