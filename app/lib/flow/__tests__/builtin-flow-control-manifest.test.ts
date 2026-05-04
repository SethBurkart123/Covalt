import { describe, expect, it } from 'vitest';

import { resolveSocketTypePropagation } from '@/lib/flow/hook-dispatch';
import { registerPlugin, resetPluginRegistryForTests } from '@/lib/flow/plugin-registry';
import { getNodeDefinition } from '@nodes/_registry';
import { builtinPluginManifest } from '@nodes/manifest';

describe('builtin flow-control manifest integration', () => {
  it('preserves conditional branch outputs', () => {
    resetPluginRegistryForTests();
    registerPlugin(builtinPluginManifest);

    const conditional = getNodeDefinition('conditional');
    const outputIds = new Set(
      (conditional?.parameters ?? [])
        .filter((param) => param.mode === 'output')
        .map((param) => param.id)
    );

    expect(outputIds).toEqual(new Set(['true', 'false']));
  });

  it('supports merge expansion and reroute socket type propagation', () => {
    resetPluginRegistryForTests();
    registerPlugin(builtinPluginManifest);

    const merge = getNodeDefinition('merge');
    const mergeInput = merge?.parameters.find((param) => param.id === 'input');
    expect(mergeInput?.autoExpand?.min).toBe(2);

    const inferred = resolveSocketTypePropagation({
      nodeType: 'reroute',
      currentType: 'data',
      data: { _socketType: 'json' },
    });
    expect(inferred).toBe('json');

    const fallback = resolveSocketTypePropagation({
      nodeType: 'reroute',
      currentType: 'data',
      data: {},
    });
    expect(fallback).toBe('data');
  });
});
