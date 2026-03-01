
'use client';

import { useMemo } from 'react';
import type { ControlProps } from './';
import type { CollectionParameter } from '@/lib/flow';
import { Button } from '@/components/ui/button';
import { Trash2, Plus } from 'lucide-react';
import { ParameterControl } from './';
import { cn } from '@/lib/utils';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function CollectionControl({ param, value, onChange, nodeId }: ControlProps) {
  const config = param as CollectionParameter;
  const rows = useMemo(() => {
    if (config.repeatable) {
      if (Array.isArray(value)) {
        return value.map(item => asRecord(item));
      }
      return [] as Record<string, unknown>[];
    }
    return [asRecord(value)] as Record<string, unknown>[];
  }, [config.repeatable, value]);

  const minItems = Math.max(0, config.minItems ?? (config.repeatable ? 0 : 1));
  const maxItems = Math.max(minItems, config.maxItems ?? Number.MAX_SAFE_INTEGER);

  const pushRow = () => {
    const next = [...rows, {}];
    onChange(config.repeatable ? next : next[0] ?? {});
  };

  const removeRow = (index: number) => {
    const next = rows.filter((_, i) => i !== index);
    onChange(config.repeatable ? next : next[0] ?? {});
  };

  const updateField = (index: number, fieldId: string, fieldValue: unknown) => {
    const next = rows.map((row, i) => (i === index ? { ...row, [fieldId]: fieldValue } : row));
    onChange(config.repeatable ? next : next[0] ?? {});
  };

  return (
    <div className="space-y-2">
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className="rounded-md border border-border p-2 space-y-2">
          {config.repeatable && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Item {rowIndex + 1}</span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() => removeRow(rowIndex)}
                disabled={rows.length <= minItems}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {config.fields.map((field: CollectionParameter['fields'][number]) => (
            <div key={field.id} className="space-y-1">
              <label className="text-xs text-muted-foreground">{field.label}</label>
              <ParameterControl
                param={field}
                value={row[field.id]}
                onChange={(next) => updateField(rowIndex, field.id, next)}
                nodeId={nodeId}
              />
            </div>
          ))}
        </div>
      ))}

      {config.repeatable && rows.length < maxItems && (
        <Button type="button" variant="secondary" size="sm" onClick={pushRow} className={cn('w-full')}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add item
        </Button>
      )}
    </div>
  );
}
