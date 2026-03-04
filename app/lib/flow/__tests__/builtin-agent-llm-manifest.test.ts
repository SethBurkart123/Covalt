import { describe, expect, it } from 'vitest';

import { registerPlugin, resetPluginRegistryForTests } from '@/lib/flow/plugin-registry';
import { builtinPluginManifest } from '@nodes/manifest';
import { getNodeDefinition, getNodeDefinitionMetadata } from '@nodes/_registry';

describe('builtin agent + llm manifest integration', () => {
  it('registers agent and llm-completion definitions through builtin plugin metadata', () => {
    resetPluginRegistryForTests();
    registerPlugin(builtinPluginManifest);

    expect(getNodeDefinitionMetadata('agent')).toEqual({
      nodeType: 'agent',
      definitionModule: 'nodes/core/agent/definition.ts',
      runtimeModule: 'nodes/core/agent/executor.py',
    });

    expect(getNodeDefinitionMetadata('llm-completion')).toEqual({
      nodeType: 'llm-completion',
      definitionModule: 'nodes/ai/llm_completion/definition.ts',
      runtimeModule: 'nodes/ai/llm_completion/executor.py',
    });
  });

  it('exposes agent parameters required for rendering tool-aware configuration', () => {
    resetPluginRegistryForTests();
    registerPlugin(builtinPluginManifest);

    const agent = getNodeDefinition('agent');
    expect(agent).toBeDefined();
    expect(agent?.executionMode).toBe('hybrid');

    const paramIds = new Set((agent?.parameters ?? []).map((param) => param.id));
    expect(paramIds.has('tools')).toBe(true);
    expect(paramIds.has('instructions')).toBe(true);
    expect(paramIds.has('model')).toBe(true);
    expect(paramIds.has('temperature')).toBe(true);

    const tools = agent?.parameters.find((param) => param.id === 'tools');
    expect(tools?.socket?.channel).toBe('link');
  });

  it('exposes llm-completion parameters required for rendering and execution controls', () => {
    resetPluginRegistryForTests();
    registerPlugin(builtinPluginManifest);

    const llm = getNodeDefinition('llm-completion');
    expect(llm).toBeDefined();
    expect(llm?.executionMode).toBe('flow');

    const paramIds = new Set((llm?.parameters ?? []).map((param) => param.id));
    expect(paramIds.has('prompt')).toBe(true);
    expect(paramIds.has('model')).toBe(true);
    expect(paramIds.has('temperature')).toBe(true);
    expect(paramIds.has('max_tokens')).toBe(true);

    const output = llm?.parameters.find((param) => param.id === 'output');
    expect(output?.mode).toBe('output');
  });
});
