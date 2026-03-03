import { describe, expect, it } from 'vitest';

import type { NodeDefinition } from '@/lib/flow';
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
