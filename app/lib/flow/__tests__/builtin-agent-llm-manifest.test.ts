import { describe, expect, it } from 'vitest';

import { registerPlugin, resetPluginRegistryForTests } from '@/lib/flow/plugin-registry';
import { builtinPluginManifest } from '@nodes/manifest';
import { getNodeDefinition } from '@nodes/_registry';

describe('builtin agent + llm manifest integration', () => {
  it('registers runnable agent and llm-completion definitions', () => {
    resetPluginRegistryForTests();
    registerPlugin(builtinPluginManifest);

    const agent = getNodeDefinition('agent');
    expect(agent?.executionMode).toBe('hybrid');
    expect(agent?.parameters.some((param) => param.id === 'tools' && param.socket?.channel === 'link')).toBe(true);

    const llm = getNodeDefinition('llm-completion');
    expect(llm?.executionMode).toBe('flow');
    expect(llm?.parameters.some((param) => param.id === 'output' && param.mode === 'output')).toBe(true);
  });
});
