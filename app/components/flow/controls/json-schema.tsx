'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ControlProps } from './';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface JsonSchemaControlProps extends Omit<ControlProps, 'onChange'> {
  value: unknown;
  onChange: (value: unknown) => void;
}

function stringify(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseJson(text: string): { value: unknown; error: string | null } {
  if (!text.trim()) return { value: {}, error: null };
  try {
    return { value: JSON.parse(text), error: null };
  } catch (err) {
    return { value: null, error: err instanceof Error ? err.message : 'Invalid JSON' };
  }
}

function inferSchema(value: unknown): Record<string, unknown> {
  const root = buildSchema(value);
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    ...root,
  };
}

function buildSchema(value: unknown): Record<string, unknown> {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) {
    const sample = value.find(v => v !== undefined);
    const itemsSchema = sample !== undefined ? buildSchema(sample) : {};
    return { type: 'array', items: itemsSchema };
  }
  if (typeof value === 'string') return { type: 'string' };
  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, val] of Object.entries(obj)) {
      properties[key] = buildSchema(val);
      required.push(key);
    }
    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }
  return {};
}

export function JsonSchemaControl({ value, onChange, param }: JsonSchemaControlProps) {
  const [text, setText] = useState(() => stringify(value ?? {}));
  const [error, setError] = useState<string | null>(null);
  const [sampleText, setSampleText] = useState('');
  const [sampleError, setSampleError] = useState<string | null>(null);
  const showGenerator = param.id === 'schema';

  useEffect(() => {
    const next = stringify(value ?? {});
    setText(next);
  }, [value]);

  const handleSchemaChange = useCallback((next: string) => {
    setText(next);
    const parsed = parseJson(next);
    setError(parsed.error);
    if (!parsed.error) {
      onChange(parsed.value);
    }
  }, [onChange]);

  const handleGenerate = useCallback(() => {
    const parsed = parseJson(sampleText);
    if (parsed.error) {
      setSampleError(parsed.error);
      return;
    }
    setSampleError(null);
    const schema = inferSchema(parsed.value);
    const schemaText = stringify(schema);
    setText(schemaText);
    setError(null);
    onChange(schema);
  }, [sampleText, onChange]);

  const samplePlaceholder = useMemo(
    () => '{\n  "id": 123,\n  "name": "Example"\n}',
    []
  );

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Textarea
          value={text}
          onChange={(e) => handleSchemaChange(e.target.value)}
          placeholder="{ }"
          className={cn(error && 'border-destructive focus-visible:ring-destructive/40')}
          rows={8}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      {showGenerator && (
        <div className="space-y-1">
          <Textarea
            value={sampleText}
            onChange={(e) => setSampleText(e.target.value)}
            placeholder={samplePlaceholder}
            rows={5}
          />
          {sampleError && <p className="text-xs text-destructive">{sampleError}</p>}
          <Button type="button" variant="secondary" size="sm" onClick={handleGenerate}>
            Generate From Sample
          </Button>
        </div>
      )}
    </div>
  );
}
