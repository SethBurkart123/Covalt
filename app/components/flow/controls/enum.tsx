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

interface EnumControlProps extends Omit<ControlProps, 'onChange'> {
  value: string | undefined;
  onChange: (value: string) => void;
}

export function EnumControl({ param, value, onChange, compact }: EnumControlProps) {
  const p = param as { default?: string; values: readonly string[] };
  
  const handleValueChange = useCallback((val: string) => {
    onChange(val);
  }, [onChange]);

  return (
    <Select
      value={value ?? p.default ?? p.values[0]}
      onValueChange={handleValueChange}
    >
      <SelectTrigger className={compact ? 'h-7 text-xs' : 'h-8'}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {p.values.map((v) => (
          <SelectItem key={v} value={v}>
            {v}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
