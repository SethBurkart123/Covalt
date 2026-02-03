'use client';

import { useCallback } from 'react';
import type { Parameter } from '@/lib/flow';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

interface BooleanControlProps {
  param: Parameter;
  value: boolean | undefined;
  onChange: (value: boolean) => void;
  compact?: boolean;
}

export function BooleanControl({ param, value, onChange, compact }: BooleanControlProps) {
  const p = param as { default?: boolean };
  const checked = value ?? p.default ?? false;
  
  const handleChange = useCallback((checked: boolean) => {
    onChange(checked);
  }, [onChange]);

  return (
    <Switch
      checked={checked}
      onCheckedChange={handleChange}
      className={cn(
        'nodrag',
        compact && 'h-4 w-7 [&>span]:h-3 [&>span]:w-3 [&>span]:data-[state=checked]:translate-x-3'
      )}
    />
  );
}
