'use client';

import { useCallback } from 'react';
import type { Parameter } from '@/lib/flow';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface FloatControlProps {
  param: Parameter;
  value: number | undefined;
  onChange: (value: number) => void;
  compact?: boolean;
}

export function FloatControl({ param, value, onChange, compact }: FloatControlProps) {
  const p = param as { default?: number; min?: number; max?: number; step?: number };
  const currentValue = value ?? p.default ?? 0;
  
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val)) {
      const clamped = Math.min(
        p.max ?? Infinity,
        Math.max(p.min ?? -Infinity, val)
      );
      onChange(clamped);
    }
  }, [onChange, p.min, p.max]);

  return (
    <Input
      type="number"
      value={currentValue}
      onChange={handleChange}
      min={p.min}
      max={p.max}
      step={p.step ?? 0.1}
      className={cn(
        'nodrag text-right',
        compact ? 'h-7 w-16 text-xs' : 'h-8 w-20'
      )}
    />
  );
}
