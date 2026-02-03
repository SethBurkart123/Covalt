'use client';

import { useCallback } from 'react';
import type { Parameter } from '@/lib/flow';
import { cn } from '@/lib/utils';

interface TextAreaControlProps {
  param: Parameter;
  value: string | undefined;
  onChange: (value: string) => void;
  compact?: boolean;
}

export function TextAreaControl({ param, value, onChange, compact }: TextAreaControlProps) {
  const p = param as { default?: string; placeholder?: string; rows?: number };
  
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  }, [onChange]);

  return (
    <textarea
      value={value ?? p.default ?? ''}
      onChange={handleChange}
      placeholder={p.placeholder}
      rows={compact ? 2 : p.rows ?? 3}
      className={cn(
        'nodrag bg-transparent border border-input rounded-md px-3 py-2 text-sm text-foreground resize-none',
        'placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        'dark:bg-input/30',
        compact ? 'w-full' : 'w-full min-h-[60px]'
      )}
    />
  );
}
