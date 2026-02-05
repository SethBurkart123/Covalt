'use client';

import { useCallback } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ControlProps } from './';

interface ToolsetPickerProps extends Omit<ControlProps, 'onChange'> {
  value: string | undefined;
  onChange: (value: string) => void;
}

/**
 * Toolset picker control.
 * TODO: Integrate with actual toolset list.
 */
export function ToolsetPicker({ value, onChange }: ToolsetPickerProps) {
  const handleValueChange = useCallback((val: string) => {
    onChange(val);
  }, [onChange]);

  // TODO: Fetch actual toolsets from backend
  const toolsets = [
    { id: 'web-search', name: 'Web Search' },
    { id: 'code-interpreter', name: 'Code Interpreter' },
    { id: 'file-tools', name: 'File Tools' },
  ];

  return (
    <Select value={value ?? ''} onValueChange={handleValueChange}>
      <SelectTrigger className="h-8 w-full">
        <SelectValue placeholder="Select toolset..." />
      </SelectTrigger>
      <SelectContent>
        {toolsets.map((t) => (
          <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
