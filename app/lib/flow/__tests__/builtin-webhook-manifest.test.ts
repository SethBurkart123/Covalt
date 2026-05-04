import { describe, expect, it } from 'vitest';

import { applyNodeCreateHooks } from '@/lib/flow/hook-dispatch';
import { registerPlugin, resetPluginRegistryForTests } from '@/lib/flow/plugin-registry';
import { builtinPluginManifest } from '@nodes/manifest';

describe('builtin webhook manifest integration', () => {
  it('auto-populates hookId via onNodeCreate without overwriting existing ids', () => {
    resetPluginRegistryForTests();
    registerPlugin(builtinPluginManifest);

    const created = applyNodeCreateHooks({
      nodeType: 'webhook-trigger',
      initialData: {},
    });

    expect(created.hookId).toEqual(expect.stringMatching(/^hook_[a-z0-9]{8}$/));

    const preserved = applyNodeCreateHooks({
      nodeType: 'webhook-trigger',
      initialData: { hookId: 'hook_existing' },
    });

    expect(preserved.hookId).toBe('hook_existing');
  });
});
