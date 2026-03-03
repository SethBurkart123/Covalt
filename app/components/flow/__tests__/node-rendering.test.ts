import { describe, expect, it } from 'vitest';

import type { NodeDefinition } from '@/lib/flow';
import { getNodeDefinition, registerPlugin, resetPluginRegistryForTests, unregisterPlugin } from '@/lib/flow';
import { resolveNodeRendererComponent } from '../node';

const baseDefinition = {
  id: 'example',
  name: 'Example Node',
  category: 'utility',
  icon: 'Box',
  executionMode: 'flow',
  parameters: [],
} as const satisfies NodeDefinition;

describe('resolveNodeRendererComponent', () => {
  it('returns plugin custom renderer when definition provides one', () => {
    const CustomRenderer = () => null;

    const result = resolveNodeRendererComponent({
      ...baseDefinition,
      component: CustomRenderer,
    });

    expect(result).toBe(CustomRenderer);
  });

  it('returns null when definition has no valid custom renderer', () => {
    expect(resolveNodeRendererComponent(baseDefinition)).toBeNull();
    expect(resolveNodeRendererComponent({ ...baseDefinition, component: {} })).toBeNull();
  });
});

describe('FlowNode renderer selection', () => {
  it('uses plugin custom renderer when one is registered for the node type', () => {
    resetPluginRegistryForTests();
    const customRenderer = () => null;

    registerPlugin({
      id: 'plugin.custom',
      name: 'Plugin Custom',
      version: '1.0.0',
      nodes: [
        {
          type: 'plugin.custom:node',
          definitionPath: 'definition.ts',
          executorPath: 'executor.py',
        },
        {
          type: 'plugin.generic:node',
          definitionPath: 'definition.ts',
          executorPath: 'executor.py',
        },
      ],
      definitions: [
        { ...baseDefinition, id: 'plugin.custom:node' },
        { ...baseDefinition, id: 'plugin.generic:node' },
      ],
      components: {
        'plugin.custom:node': customRenderer,
      },
    });

    const customResult = resolveNodeRendererComponent(getNodeDefinition('plugin.custom:node'));
    expect(customResult).toBe(customRenderer);

    const genericResult = resolveNodeRendererComponent(getNodeDefinition('plugin.generic:node'));
    expect(genericResult).toBeNull();

    unregisterPlugin('plugin.custom');
    resetPluginRegistryForTests();
  });
});
