'use client';

import { useCallback } from 'react';
import { Input } from '@/components/ui/input';
import type { ControlProps } from './';

interface StringControlProps extends Omit<ControlProps, 'onChange'> {
  value: string | undefined;
  onChange: (value: string) => void;
}

export function StringControl({ param, value, onChange, compact }: StringControlProps) {
  const p = param as { default?: string; placeholder?: string };
  
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  }, [onChange]);

  return (
    <Input
      type="text"
      value={value ?? p.default ?? ''}
      onChange={handleChange}
      placeholder={p.placeholder}
      className={compact ? 'h-7 text-xs w-full' : 'h-8 w-full'}
    />
  );
}
