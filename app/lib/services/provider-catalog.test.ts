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
          aliases: [],
        },
      ],
    });

    const providers = await fetchProviderCatalog({ force: true });
    expect(providers).toHaveLength(1);
    expect(providers[0].provider).toBe('openai');
    expect(requestMock).toHaveBeenCalledTimes(2);
  });
});
