import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { NodeDefinition } from '@nodes/_types';
import type { PluginManifest } from '@nodes/_manifest';
import {
  getNodeDefinition,
  getNodeDefinitionMetadata,
  listAllNodeDefinitions,
  registerPlugin,
  resetPluginRegistryForTests,
  unregisterPlugin,
} from '@/lib/flow/plugin-registry';
import { dispatchHook } from '@/lib/flow/plugin-hooks';

function makeDefinition(overrides: Partial<NodeDefinition> = {}): NodeDefinition {
  return {
    id: 'test-node',
    name: 'Test Node',
    category: 'utility',
    icon: 'Puzzle',
    executionMode: 'flow',
    parameters: [],
    ...overrides,
  };
}

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  const definition = makeDefinition({ id: 'test-node' });
  return {
    id: 'plugin.test',
    name: 'Test Plugin',
    version: '1.0.0',
    nodes: [
      {
        type: definition.id,
        definitionPath: 'nodes/test/definition.ts',
        executorPath: 'nodes/test/executor.py',
      },
    ],
    definitions: [definition],
    ...overrides,
  };
}

describe('plugin-registry', () => {
  beforeEach(() => {
    resetPluginRegistryForTests();
  });

  afterEach(() => {
    resetPluginRegistryForTests();
  });

  it('registers plugin definitions and metadata', () => {
    registerPlugin(makeManifest());

    const node = getNodeDefinition('test-node');
    expect(node?.name).toBe('Test Node');

    const metadata = getNodeDefinitionMetadata('test-node');
    expect(metadata).toEqual({
      nodeType: 'test-node',
      definitionModule: 'nodes/test/definition.ts',
      runtimeModule: 'nodes/test/executor.py',
    });

    expect(listAllNodeDefinitions().map((item) => item.id)).toEqual(['test-node']);
  });

  it('attaches custom components from plugin manifest', () => {
    const customComponent = Symbol('custom-component');

    registerPlugin(
      makeManifest({
        components: {
          'test-node': customComponent,
        },
      })
    );

    expect(getNodeDefinition('test-node')?.component).toBe(customComponent);
  });

  it('registers plugin hooks and dispatches them', () => {
    registerPlugin(
      makeManifest({
        hooks: {
          onNodeCreate: (context) => ({ ...context.initialData, fromPlugin: true }),
        },
      })
    );

    expect(
      dispatchHook('onNodeCreate', {
        nodeType: 'test-node',
        initialData: { value: 1 },
      })
    ).toEqual([{ value: 1, fromPlugin: true }]);
  });

  it('registers per-node hooks with automatic type filtering', () => {
    registerPlugin(
      makeManifest({
        nodes: [
          {
            type: 'test-node',
            definitionPath: 'nodes/test/definition.ts',
            executorPath: 'nodes/test/executor.py',
            hooks: {
              onNodeCreate: () => ({ matched: true }),
            },
          },
        ],
        definitions: [makeDefinition({ id: 'test-node' })],
      })
    );

    expect(dispatchHook('onNodeCreate', { nodeType: 'test-node', initialData: {} })).toEqual([{ matched: true }]);
    expect(dispatchHook('onNodeCreate', { nodeType: 'other-node', initialData: {} })).toEqual([]);
  });

  it('unregisters plugin definitions and hooks', () => {
    const manifest = makeManifest({
      hooks: {
        onConnectionValidate: () => false,
      },
    });

    registerPlugin(manifest);
    expect(getNodeDefinition('test-node')).toBeDefined();

    expect(unregisterPlugin(manifest.id)).toBe(true);
    expect(getNodeDefinition('test-node')).toBeUndefined();
    expect(dispatchHook('onConnectionValidate', {})).toEqual([]);
  });

  it('rejects duplicate node type registrations', () => {
    registerPlugin(makeManifest({ id: 'plugin.one' }));

    expect(() =>
      registerPlugin(
        makeManifest({
          id: 'plugin.two',
          definitions: [makeDefinition({ id: 'test-node', name: 'Other' })],
        })
      )
    ).toThrow("Node type 'test-node' is already registered by plugin 'plugin.one'");
  });

  it('validates manifest structure and reports missing fields clearly', () => {
    expect(() => registerPlugin({} as PluginManifest)).toThrow("Plugin manifest is missing required field 'id'");
    expect(() => registerPlugin({ id: 'x' } as PluginManifest)).toThrow("Plugin manifest is missing required field 'name'");
    expect(() => registerPlugin({ id: 'x', name: 'X' } as PluginManifest)).toThrow(
      "Plugin manifest is missing required field 'version'"
    );
    expect(() => registerPlugin({ id: 'x', name: 'X', version: '1.0.0' } as PluginManifest)).toThrow(
      "Plugin manifest is missing required field 'nodes'"
    );
  });
});
