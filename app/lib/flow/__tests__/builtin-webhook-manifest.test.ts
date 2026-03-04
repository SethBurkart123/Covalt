import { describe, expect, it } from 'vitest';

import { applyNodeCreateHooks } from '@/lib/flow/hook-dispatch';
import { registerPlugin, resetPluginRegistryForTests } from '@/lib/flow/plugin-registry';
import { builtinPluginManifest } from '@nodes/manifest';
import { getNodeDefinitionMetadata } from '@nodes/_registry';

describe('builtin webhook manifest integration', () => {
  it('registers webhook-trigger definition metadata and auto-populates hookId via onNodeCreate', () => {
    resetPluginRegistryForTests();

    registerPlugin(builtinPluginManifest);

    const metadata = getNodeDefinitionMetadata('webhook-trigger');
    expect(metadata).toEqual({
      nodeType: 'webhook-trigger',
      definitionModule: 'nodes/core/webhook_trigger/definition.ts',
      runtimeModule: 'nodes/core/webhook_trigger/executor.py',
    });

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

  it('registers webhook-end definition metadata through the builtin manifest', () => {
    resetPluginRegistryForTests();

    registerPlugin(builtinPluginManifest);

    expect(getNodeDefinitionMetadata('webhook-end')).toEqual({
      nodeType: 'webhook-end',
      definitionModule: 'nodes/core/webhook_end/definition.ts',
      runtimeModule: 'nodes/core/webhook_end/executor.py',
    });
  });
});
