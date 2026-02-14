'use client';

import { useCallback } from 'react';
import type { Parameter } from '@/lib/flow';
import { DraggableNumberInput } from '@/components/ui/draggable-number-input';
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
  const step = p.step ?? (param.type === 'int' ? 1 : undefined);
  
  const handleChange = useCallback((nextValue: number) => {
    const clamped = Math.min(
      p.max ?? Infinity,
      Math.max(p.min ?? -Infinity, nextValue)
    );
    onChange(clamped);
  }, [onChange, p.min, p.max]);

  return (
    <DraggableNumberInput
      value={currentValue}
      onChange={handleChange}
      min={p.min}
      max={p.max}
      step={step}
      compact={compact}
      className={cn(
        'w-full'
      )}
    />
  );
}
