import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridgeMocks = vi.hoisted(() => ({
  requestMock: vi.fn(),
  initBridgeMock: vi.fn(),
}));

vi.mock('./_internal', () => ({
  initBridge: bridgeMocks.initBridgeMock,
  BridgeRequestError: class BridgeRequestError extends Error {},
  request: bridgeMocks.requestMock,
  createChannel: vi.fn(),
  createUpload: vi.fn(),
  getBaseUrl: vi.fn(() => 'http://localhost:8000'),
}));

import {
  getMcpOauthStatus,
  getProviderOauthStatus,
  initBridge,
  startMcpOauth,
  startProviderOauth,
} from './api';

describe('python api bridge wrappers', () => {
  beforeEach(() => {
    bridgeMocks.requestMock.mockReset();
    bridgeMocks.initBridgeMock.mockReset();
  });

  it('forwards mcp oauth commands to bridge request', async () => {
    bridgeMocks.requestMock.mockResolvedValueOnce({ status: 'authenticated' });
    bridgeMocks.requestMock.mockResolvedValueOnce({ success: true, authUrl: 'https://oauth.example' });

    await getMcpOauthStatus({ body: { id: 'server-1' } });
    await startMcpOauth({ body: { serverId: 'server-1', serverUrl: 'https://mcp.example' } });

    expect(bridgeMocks.requestMock).toHaveBeenNthCalledWith(1, 'get_mcp_oauth_status', {
      body: { id: 'server-1' },
    });
    expect(bridgeMocks.requestMock).toHaveBeenNthCalledWith(2, 'start_mcp_oauth', {
      body: { serverId: 'server-1', serverUrl: 'https://mcp.example' },
    });
  });

  it('forwards provider oauth commands to bridge request', async () => {
    bridgeMocks.requestMock.mockResolvedValueOnce({ status: 'pending' });
    bridgeMocks.requestMock.mockResolvedValueOnce({ success: true, status: 'pending' });

    await getProviderOauthStatus({ body: { provider: 'github' } });
    await startProviderOauth({ body: { provider: 'github' } });

    expect(bridgeMocks.requestMock).toHaveBeenNthCalledWith(1, 'get_provider_oauth_status', {
      body: { provider: 'github' },
    });
    expect(bridgeMocks.requestMock).toHaveBeenNthCalledWith(2, 'start_provider_oauth', {
      body: { provider: 'github' },
    });
  });

  it('re-exports initBridge passthrough', () => {
    initBridge('https://backend.example');
    expect(bridgeMocks.initBridgeMock).toHaveBeenCalledWith('https://backend.example');
  });
});
