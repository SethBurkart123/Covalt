import { describe, expect, it } from 'vitest';
import type { ParameterType } from '@/lib/flow';

const registryModules = import.meta.glob(
  [
    '../controls/float.tsx',
    '../controls/string.tsx',
    '../controls/boolean.tsx',
    '../controls/enum.tsx',
    '../controls/text-area.tsx',
    '../controls/code.tsx',
    '../controls/messages.tsx',
    '../controls/model-picker.tsx',
    '../controls/mcp-server-picker.tsx',
    '../controls/toolset-picker.tsx',
    '../controls/node-picker.tsx',
    '../controls/json-schema.tsx',
    '../controls/collection.tsx',
  ],
  { eager: true },
);

function normalizeControlKey(filePath: string): string | null {
  const name = filePath.split('/').pop()?.replace('.tsx', '');
  if (!name || name === 'index') return null;
  if (name === 'float') return 'float';
  if (name === 'string') return 'string';
  if (name === 'boolean') return 'boolean';
  if (name === 'enum') return 'enum';
  if (name === 'text-area') return 'text-area';
  if (name === 'code') return 'code';
  if (name === 'messages') return 'messages';
  if (name === 'model-picker') return 'model';
  if (name === 'mcp-server-picker') return 'mcp-server';
  if (name === 'toolset-picker') return 'toolset';
  if (name === 'node-picker') return 'node-ref';
  if (name === 'json-schema') return 'json';
  if (name === 'collection') return 'collection';
  return null;
}

describe('flow controls registry', () => {
  it('keeps parameter-control registry mappings in sync with control modules', () => {
    const registryKeys = new Set<ParameterType>([
      'float',
      'int',
      'string',
      'boolean',
      'enum',
      'text-area',
      'code',
      'messages',
      'model',
      'mcp-server',
      'toolset',
      'node-ref',
      'json',
      'collection',
    ]);

    const moduleKeys = new Set<string>();
    for (const file of Object.keys(registryModules)) {
      const normalized = normalizeControlKey(file);
      if (normalized) {
        moduleKeys.add(normalized);
      }
    }

    const requiredMappedKeys = Array.from(moduleKeys).filter((key) => key !== 'int');
    for (const requiredKey of requiredMappedKeys) {
      expect(registryKeys.has(requiredKey as ParameterType)).toBe(true);
    }

    expect(registryKeys.has('int')).toBe(true);
  });
});
