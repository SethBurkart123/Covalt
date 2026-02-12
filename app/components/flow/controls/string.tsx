'use client';

import { useCallback } from 'react';
import { Input } from '@/components/ui/input';
import type { ControlProps } from './';
import { applyExpressionDrop, shouldHandleExpressionDrop } from './expression-drop';

interface StringControlProps extends Omit<ControlProps, 'onChange'> {
  value: string | undefined;
  onChange: (value: string) => void;
}

export function StringControl({ param, value, onChange, compact }: StringControlProps) {
  const p = param as { default?: string; placeholder?: string };
  const currentValue = value ?? p.default ?? '';
  
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  }, [onChange]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLInputElement>) => {
    applyExpressionDrop(e, currentValue, onChange);
  }, [currentValue, onChange]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLInputElement>) => {
    if (shouldHandleExpressionDrop(e)) {
      e.preventDefault();
    }
  }, []);

  return (
    <Input
      type="text"
      value={currentValue}
      onChange={handleChange}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      placeholder={p.placeholder}
      className={compact ? 'h-7 text-xs w-full' : 'h-8 w-full'}
    />
  );
}
