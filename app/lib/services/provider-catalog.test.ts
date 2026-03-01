import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/python/_internal', () => ({
  request: vi.fn(),
}));

vi.mock('@/(app)/(pages)/settings/providers/provider-icons', () => ({
  getProviderIcon: () => (() => null),
}));

import { request } from '@/python/_internal';
import { fetchProviderCatalog } from '@/lib/services/provider-catalog';

const requestMock = vi.mocked(request);

describe('provider-catalog service', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('resets failed in-flight promise and succeeds on retry', async () => {
    requestMock.mockRejectedValueOnce(new Error('temporary failure'));

    await expect(fetchProviderCatalog({ force: true })).rejects.toThrow('temporary failure');

    requestMock.mockResolvedValueOnce({
      providers: [
        {
          key: 'openai',
          provider: 'openai',
          name: 'OpenAI',
          description: 'OpenAI API',
          icon: 'openai',
          authType: 'apiKey',
          defaultEnabled: true,
          defaultBaseUrl: null,
          oauthVariant: null,
          oauthEnterpriseDomain: false,
          fieldMode: 'standard_api_key',
          aliases: [],
        },
      ],
    });

    const providers = await fetchProviderCatalog({ force: true });
    expect(providers).toHaveLength(1);
    expect(providers[0].provider).toBe('openai');
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('maps backend fieldMode values to field definitions', async () => {
    requestMock.mockResolvedValueOnce({
      providers: [
        {
          key: 'openai_like',
          provider: 'openai_like',
          name: 'OpenAI Compatible (Custom)',
          description: 'Any OpenAI-like API endpoint',
          icon: 'openai',
          authType: 'apiKey',
          defaultEnabled: true,
          defaultBaseUrl: null,
          oauthVariant: null,
          oauthEnterpriseDomain: false,
          fieldMode: 'openai_compatible',
          aliases: [],
        },
        {
          key: 'ollama',
          provider: 'ollama',
          name: 'Ollama (Local)',
          description: 'Local models running on your machine',
          icon: 'ollama',
          authType: 'apiKey',
          defaultEnabled: true,
          defaultBaseUrl: 'http://localhost:11434',
          oauthVariant: null,
          oauthEnterpriseDomain: false,
          fieldMode: 'local_ollama',
          aliases: [],
        },
      ],
    });

    const providers = await fetchProviderCatalog({ force: true });
    expect(providers[0].fields.map((field) => field.id)).toEqual(['apiKey', 'baseUrl']);
    expect(providers[0].fields[1]?.label).toBe('Base URL');
    expect(providers[1].fields.map((field) => field.id)).toEqual(['baseUrl']);
    expect(providers[1].fields[0]?.label).toBe('Host URL');
  });
});
