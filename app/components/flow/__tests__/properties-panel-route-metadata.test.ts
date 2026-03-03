import { describe, expect, it } from 'vitest';

import type { NodeDefinition } from '@/lib/flow';
import { buildRouteDisplayState } from '../properties-panel';

const definition = {
  id: 'custom-trigger',
  name: 'Custom Trigger',
  category: 'trigger',
  icon: 'Webhook',
  executionMode: 'hybrid',
  parameters: [],
  metadata: {
    route: {
      idField: 'hookId',
      path: '/webhooks/{id}',
      label: 'Webhook URL',
      idPrefix: 'hook_',
      emptyValuePlaceholder: 'Generate a hook id first',
    },
  },
} as const satisfies NodeDefinition;

describe('buildRouteDisplayState', () => {
  it('returns metadata-driven route URL for route-capable definitions', () => {
    const result = buildRouteDisplayState({
      definition,
      data: { hookId: 'hook_123' },
      backendBaseUrl: 'http://localhost:8899',
    });

    expect(result).toEqual({
      label: 'Webhook URL',
      idField: 'hookId',
      value: 'hook_123',
      url: 'http://localhost:8899/webhooks/hook_123',
      canGenerate: false,
      emptyValuePlaceholder: 'Generate a hook id first',
      idPrefix: 'hook_',
    });
  });

  it('returns null when definition is not route-capable', () => {
    const result = buildRouteDisplayState({
      definition: {
        ...definition,
        metadata: undefined,
      },
      data: { hookId: 'hook_abc' },
      backendBaseUrl: 'http://localhost:8899',
    });

    expect(result).toBeNull();
  });
});
