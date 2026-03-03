import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatchHook, deregisterHooks, registerHook, resetHooksForTests } from '@/lib/flow/plugin-hooks';

describe('plugin-hooks', () => {
  beforeEach(() => {
    resetHooksForTests();
  });

  afterEach(() => {
    resetHooksForTests();
  });

  it('dispatches handlers in registration order', () => {
    registerHook('plugin.alpha', 'onNodeCreate', (context) => ({
      tag: `alpha-${String(context.nodeType)}`,
    }));
    registerHook('plugin.beta', 'onNodeCreate', (context) => ({
      tag: `beta-${String(context.nodeType)}`,
    }));

    const results = dispatchHook('onNodeCreate', { nodeType: 'agent', initialData: {} });

    expect(results).toEqual([
      { tag: 'alpha-agent' },
      { tag: 'beta-agent' },
    ]);
  });

  it('filters out nullish hook results', () => {
    registerHook('plugin.alpha', 'onConnectionValidate', () => undefined);
    registerHook('plugin.beta', 'onConnectionValidate', () => null);
    registerHook('plugin.gamma', 'onConnectionValidate', () => true);

    const results = dispatchHook('onConnectionValidate', {
      sourceNodeType: 'agent',
      targetNodeType: 'reroute',
    });

    expect(results).toEqual([true]);
  });

  it('isolates hook failures and continues dispatching', () => {
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    registerHook('plugin.alpha', 'onSocketTypePropagate', () => {
      throw new Error('boom');
    });
    registerHook('plugin.beta', 'onSocketTypePropagate', () => 'json');

    const results = dispatchHook('onSocketTypePropagate', { nodeType: 'reroute' });

    expect(results).toEqual(['json']);
    expect(logSpy).toHaveBeenCalledTimes(1);

    logSpy.mockRestore();
  });

  it('deregisters every hook belonging to a plugin', () => {
    registerHook('plugin.alpha', 'onNodeCreate', () => ({ hookId: 'a' }));
    registerHook('plugin.alpha', 'onConnectionValidate', () => false);
    registerHook('plugin.beta', 'onNodeCreate', () => ({ hookId: 'b' }));

    deregisterHooks('plugin.alpha');

    expect(dispatchHook('onNodeCreate', { nodeType: 'webhook-trigger', initialData: {} })).toEqual([{ hookId: 'b' }]);
    expect(dispatchHook('onConnectionValidate', {})).toEqual([]);
  });
});
