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

interface McpServerPickerProps extends Omit<ControlProps, 'onChange'> {
  value: string | undefined;
  onChange: (value: string) => void;
}

/**
 * MCP Server picker control.
 * TODO: Integrate with actual MCP server list.
 */
export function McpServerPicker({ value, onChange }: McpServerPickerProps) {
  const handleValueChange = useCallback((val: string) => {
    onChange(val);
  }, [onChange]);

  // TODO: Fetch actual MCP servers from backend
  const servers = [
    { id: 'filesystem', name: 'Filesystem' },
    { id: 'context7', name: 'Context7' },
    { id: 'github', name: 'GitHub' },
    { id: 'postgres', name: 'PostgreSQL' },
  ];

  return (
    <Select value={value ?? ''} onValueChange={handleValueChange}>
      <SelectTrigger className="h-8">
        <SelectValue placeholder="Select server..." />
      </SelectTrigger>
      <SelectContent>
        {servers.map((s) => (
          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
