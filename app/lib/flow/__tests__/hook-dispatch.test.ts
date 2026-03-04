import { beforeEach, describe, expect, it } from 'vitest';

import { registerHook, resetHooksForTests } from '@/lib/flow/plugin-hooks';
import { applyNodeCreateHooks, resolveSocketTypePropagation } from '@/lib/flow/hook-dispatch';

describe('hook-dispatch helpers', () => {
  beforeEach(() => {
    resetHooksForTests();
  });

  it('merges onNodeCreate hook patches in registration order', () => {
    registerHook('plugin.alpha', 'onNodeCreate', () => ({ hookId: 'hook_alpha' }));
    registerHook('plugin.beta', 'onNodeCreate', (context) => ({
      marker: context.nodeType,
      hookId: 'hook_beta',
    }));

    const result = applyNodeCreateHooks({
      nodeType: 'custom-trigger',
      initialData: { existing: true },
    });

    expect(result).toEqual({
      existing: true,
      marker: 'custom-trigger',
      hookId: 'hook_beta',
    });
  });

  it('returns propagated socket type from registered hooks', () => {
    registerHook('plugin.bridge', 'onSocketTypePropagate', (context) => {
      const raw = context.data?._socketType;
      return typeof raw === 'string' ? raw : context.currentType;
    });

    const unresolved = resolveSocketTypePropagation({
      nodeType: 'bridge-node',
      currentType: 'data',
      data: {},
    });

    const resolved = resolveSocketTypePropagation({
      nodeType: 'bridge-node',
      currentType: 'data',
      data: { _socketType: 'json' },
    });

    expect(unresolved).toBe('data');
    expect(resolved).toBe('json');
  });
});
