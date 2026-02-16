import type {
  FlowNodeExecutionSnapshot,
  FlowOutputPortSnapshot,
} from '@/contexts/agent-test-chat-context';
import { getNodeDefinition } from '@/lib/flow';

export interface PathRow {
  path: string;
  value: unknown;
  type: string;
}

const ARRAY_SAMPLE_LIMIT = 5;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function valueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

export function collectObjectRows(value: unknown, prefix = '', depth = 0): PathRow[] {
  if (depth > 6) {
    return [{ path: prefix, value, type: valueType(value) }];
  }

  if (Array.isArray(value)) {
    const rows: PathRow[] = [{ path: prefix, value, type: 'array' }];
    const sample = sampleArrayValue(value);
    if (sample === undefined) return rows;

    const indexPath = prefix ? `${prefix}[0]` : '[0]';
    rows.push(...collectArrayItemRows(sample, indexPath, depth + 1));
    return rows;
  }

  if (!isRecord(value)) {
    return [{ path: prefix, value, type: valueType(value) }];
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    return [{ path: prefix, value, type: 'object' }];
  }

  return entries.flatMap(([key, nestedValue]) => {
    const nextPath = prefix ? `${prefix}.${key}` : key;
    return collectObjectRows(nestedValue, nextPath, depth + 1);
  });
}

export function sampleArrayValue(values: unknown[]): unknown {
  const sample = values.slice(0, ARRAY_SAMPLE_LIMIT).filter(value => value !== null && value !== undefined);
  if (sample.length === 0) return undefined;

  const first = sample[0];
  if (Array.isArray(first)) {
    return first;
  }

  if (isRecord(first)) {
    const merged: Record<string, unknown> = {};
    for (const item of sample) {
      if (!isRecord(item)) continue;
      for (const [key, value] of Object.entries(item)) {
        if (!(key in merged)) merged[key] = value;
      }
    }
    return merged;
  }

  return first;
}

function collectArrayItemRows(value: unknown, prefix: string, depth: number): PathRow[] {
  const rows: PathRow[] = [{ path: prefix, value, type: valueType(value) }];
  if (depth > 6) return rows;

  if (Array.isArray(value)) {
    const sample = sampleArrayValue(value);
    if (sample === undefined) return rows;
    const indexPath = `${prefix}[0]`;
    rows.push(...collectArrayItemRows(sample, indexPath, depth + 1));
    return rows;
  }

  if (!isRecord(value)) return rows;

  for (const [key, nestedValue] of Object.entries(value)) {
    const nextPath = `${prefix}.${key}`;
    rows.push(...collectObjectRows(nestedValue, nextPath, depth + 1));
  }

  return rows;
}

export function formatPreview(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value) || isRecord(value)) {
    return stringifyPreview(value);
  }
  return String(value);
}

export function formatSchemaPreview(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (isRecord(value)) return '{...}';
  return String(value);
}

export function escapeLabel(label: string): string {
  return label.replace(/'/g, "\\'");
}

export function buildNodeExpression(nodeName: string, path: string): string {
  const escaped = escapeLabel(nodeName);
  if (!path) return `{{ $('${escaped}').item.json }}`;
  return `{{ $('${escaped}').item.json.${path} }}`;
}

export function buildInputExpression(path: string): string {
  if (!path) return '{{ $input }}';
  return `{{ $input.${path} }}`;
}

export function buildTriggerExpression(path: string): string {
  if (!path) return '{{ $trigger }}';
  return `{{ $trigger.${path} }}`;
}

export function getNodeName(node: { type?: string; data?: Record<string, unknown> }): string {
  const label = node.data?._label;
  if (typeof label === 'string' && label.trim()) return label;

  const definition = getNodeDefinition(node.type || '');
  if (definition) return definition.name;

  return node.type || 'Node';
}

export function pickPrimaryOutput(snapshot?: FlowNodeExecutionSnapshot): { type: string | null; value: unknown } {
  if (!snapshot?.outputs) return { type: null, value: undefined };

  const output = snapshot.outputs.output ?? snapshot.outputs.true ?? snapshot.outputs.false;
  if (output) return { type: output.type ?? null, value: output.value };

  const first = Object.values(snapshot.outputs)[0] as FlowOutputPortSnapshot | undefined;
  if (!first) return { type: null, value: undefined };
  return { type: first.type ?? null, value: first.value };
}

function stringifyPreview(value: unknown): string {
  try {
    const raw = JSON.stringify(value, null, 2);
    if (raw.length <= 400) return raw;
    return `${raw.slice(0, 400)}…`;
  } catch {
    return '{...}';
  }
}
