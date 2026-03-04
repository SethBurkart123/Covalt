import { describe, expect, it } from 'vitest';

import { resolveSocketTypePropagation } from '@/lib/flow/hook-dispatch';
import { registerPlugin, resetPluginRegistryForTests } from '@/lib/flow/plugin-registry';
import { getNodeDefinition, getNodeDefinitionMetadata } from '@nodes/_registry';
import { builtinPluginManifest } from '@nodes/manifest';

describe('builtin flow-control manifest integration', () => {
  it('registers conditional, merge, and reroute definitions through builtin plugin metadata', () => {
    resetPluginRegistryForTests();
    registerPlugin(builtinPluginManifest);

    expect(getNodeDefinitionMetadata('conditional')).toEqual({
      nodeType: 'conditional',
      definitionModule: 'nodes/flow/conditional/definition.ts',
      runtimeModule: 'nodes/flow/conditional/executor.py',
    });

    expect(getNodeDefinitionMetadata('merge')).toEqual({
      nodeType: 'merge',
      definitionModule: 'nodes/flow/merge/definition.ts',
      runtimeModule: 'nodes/flow/merge/executor.py',
    });

    expect(getNodeDefinitionMetadata('reroute')).toEqual({
      nodeType: 'reroute',
      definitionModule: 'nodes/flow/reroute/definition.ts',
      runtimeModule: 'nodes/flow/reroute/executor.py',
    });
  });

  it('exposes conditional operators and explicit true/false outputs', () => {
    resetPluginRegistryForTests();
    registerPlugin(builtinPluginManifest);

    const conditional = getNodeDefinition('conditional');
    expect(conditional).toBeDefined();

    const operator = conditional?.parameters.find((param) => param.id === 'operator');
    expect(operator?.type).toBe('enum');

    const operatorValues = new Set((operator?.type === 'enum' ? operator.values : []) ?? []);
    for (const required of [
      'equals',
      'notEquals',
      'contains',
      'notContains',
      'greaterThan',
      'lessThan',
      'exists',
      'notExists',
    ]) {
      expect(operatorValues.has(required)).toBe(true);
    }

    const outputIds = new Set(
      (conditional?.parameters ?? [])
        .filter((param) => param.mode === 'output')
        .map((param) => param.id)
    );
    expect(outputIds).toEqual(new Set(['true', 'false']));
  });

  it('supports merge expansion and reroute socket type propagation metadata/hooks', () => {
    resetPluginRegistryForTests();
    registerPlugin(builtinPluginManifest);

    const merge = getNodeDefinition('merge');
    const mergeInput = merge?.parameters.find((param) => param.id === 'input');
    expect(mergeInput?.autoExpand?.min).toBe(2);

    const mergeOutputs = (merge?.parameters ?? []).filter((param) => param.mode === 'output');
    expect(mergeOutputs.map((param) => param.id)).toEqual(['output']);

    const reroute = getNodeDefinition('reroute');
    expect(reroute?.metadata?.socketTypePropagation).toMatchObject({
      stateField: '_socketType',
      inputHandle: 'input',
      outputHandle: 'output',
      supportsEdgeInsertion: true,
    });

    const defaultValueParam = reroute?.parameters.find((param) => param.id === 'value');
    expect(defaultValueParam?.showWhen).toEqual({ notConnected: 'input' });

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
