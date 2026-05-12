import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/python/api', () => ({
  listNodeProviderDefinitions: vi.fn(),
}));

vi.mock('@/lib/flow', () => ({
  registerPlugin: vi.fn(),
  unregisterPlugin: vi.fn(),
}));

import { listNodeProviderDefinitions } from '@/python/api';
import { registerPlugin, unregisterPlugin } from '@/lib/flow';
import { refreshNodeProviderDefinitions } from './node-provider-definitions';

const requestMock = vi.mocked(listNodeProviderDefinitions);
const registerPluginMock = vi.mocked(registerPlugin);
const unregisterPluginMock = vi.mocked(unregisterPlugin);

describe('node-provider-definitions service', () => {
  beforeEach(() => {
    requestMock.mockReset();
    registerPluginMock.mockReset();
    unregisterPluginMock.mockReset();
  });

  it('registers external provider definitions through plugin registry by pluginId', async () => {
    requestMock.mockResolvedValueOnce({
      definitions: [
        {
          type: 'external.alpha:trigger',
          name: 'Alpha Trigger',
          category: 'trigger',
          icon: 'Zap',
          executionMode: 'flow',
          parameters: [],
          pluginId: 'external.alpha',
        },
        {
          type: 'external.alpha:action',
          name: 'Alpha Action',
          category: 'integration',
          icon: 'Bolt',
          executionMode: 'flow',
          parameters: [],
          pluginId: 'external.alpha',
        },
        {
          type: 'external.beta:node',
          name: 'Beta Node',
          category: 'utility',
          icon: 'Square',
          executionMode: 'flow',
          parameters: [],
          pluginId: 'external.beta',
        },
      ],
    });

    await refreshNodeProviderDefinitions();

    expect(unregisterPluginMock).toHaveBeenCalledTimes(2);
    expect(unregisterPluginMock).toHaveBeenCalledWith('external.alpha');
    expect(unregisterPluginMock).toHaveBeenCalledWith('external.beta');

    expect(registerPluginMock).toHaveBeenCalledTimes(2);

    const alphaManifest = registerPluginMock.mock.calls.find(
      ([manifest]) => manifest.id === 'external.alpha'
    )?.[0];
    expect(alphaManifest).toBeDefined();
    expect(alphaManifest?.nodes).toHaveLength(2);
    expect(alphaManifest?.nodes.map((node) => node.type)).toEqual([
      'external.alpha:trigger',
      'external.alpha:action',
    ]);

    const betaManifest = registerPluginMock.mock.calls.find(
      ([manifest]) => manifest.id === 'external.beta'
    )?.[0];
    expect(betaManifest?.nodes).toHaveLength(1);
    expect(betaManifest?.nodes[0]?.type).toBe('external.beta:node');
  });

  it('unregisters stale provider plugins that disappear from subsequent refreshes', async () => {
    requestMock
      .mockResolvedValueOnce({
        definitions: [
          {
            type: 'external.alpha:trigger',
            name: 'Alpha Trigger',
            category: 'trigger',
            icon: 'Zap',
            executionMode: 'flow',
            parameters: [],
            pluginId: 'external.alpha',
          },
        ],
      })
      .mockResolvedValueOnce({
        definitions: [
          {
            type: 'external.beta:node',
            name: 'Beta Node',
            category: 'utility',
            icon: 'Square',
            executionMode: 'flow',
            parameters: [],
            pluginId: 'external.beta',
          },
        ],
      });

    await refreshNodeProviderDefinitions();
    await refreshNodeProviderDefinitions();

    expect(unregisterPluginMock).toHaveBeenCalledWith('external.alpha');
    expect(unregisterPluginMock).toHaveBeenCalledWith('external.beta');
    expect(registerPluginMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to providerId when pluginId is absent', async () => {
    requestMock.mockResolvedValueOnce({
      definitions: [
        {
          type: 'covalt-n8n-nodes:httpRequest',
          name: 'HTTP Request',
          category: 'integration',
          icon: 'Globe',
          executionMode: 'flow',
          parameters: [],
          providerId: 'covalt-n8n-nodes',
        },
      ],
    });

    await refreshNodeProviderDefinitions();

    expect(unregisterPluginMock).toHaveBeenCalledWith('covalt-n8n-nodes');
    const manifest = registerPluginMock.mock.calls[0]?.[0];
    expect(manifest.id).toBe('covalt-n8n-nodes');
    expect(manifest.nodes[0]?.type).toBe('covalt-n8n-nodes:httpRequest');
  });
});
