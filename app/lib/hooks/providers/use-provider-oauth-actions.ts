import { useCallback, type Dispatch, type SetStateAction } from 'react';
import {
  getProviderOauthStatus,
  revokeProviderOauth,
  startProviderOauth,
  submitProviderOauthCode,
} from '@/python/api';
import type { OAuthState } from './types';
import { normalizeOAuthStatus } from './types';
import { useOauthPolling } from '@/lib/hooks/use-oauth-polling';

interface UseProviderOauthActionsParams {
  setOauthStatus: Dispatch<SetStateAction<Record<string, OAuthState>>>;
  setOauthAuthenticating: Dispatch<SetStateAction<Record<string, boolean>>>;
  setOauthSubmitting: Dispatch<SetStateAction<Record<string, boolean>>>;
  setOauthRevoking: Dispatch<SetStateAction<Record<string, boolean>>>;
  refreshModels?: () => Promise<void> | void;
  openOauthWindow: (url: string) => void;
}

export function useProviderOauthActions({
  setOauthStatus,
  setOauthAuthenticating,
  setOauthSubmitting,
  setOauthRevoking,
  refreshModels,
  openOauthWindow,
}: UseProviderOauthActionsParams) {
  const { startOauthPolling, stopOauthPolling } = useOauthPolling(openOauthWindow);

  const applyProviderOauthStatus = useCallback(
    (
      providerId: string,
      status: {
        status?: unknown;
        hasTokens?: boolean;
        authUrl?: string;
        instructions?: string;
        error?: string;
      },
    ): OAuthState["status"] => {
      const normalized = normalizeOAuthStatus(status.status);
      setOauthStatus((prev) => ({
        ...prev,
        [providerId]: {
          status: normalized,
          hasTokens: status.hasTokens,
          authUrl: status.authUrl,
          instructions: status.instructions,
          error: status.error,
        },
      }));
      return normalized;
    },
    [setOauthStatus],
  );

  const setOauthError = useCallback(
    (providerId: string, fallbackMessage: string, error?: unknown) => {
      const message =
        typeof error === 'string'
          ? error
          : error instanceof Error
            ? error.message
            : fallbackMessage;
      setOauthStatus((prev) => ({
        ...prev,
        [providerId]: {
          status: 'error',
          error: message,
        },
      }));
    },
    [setOauthStatus],
  );

  const startOauth = useCallback(
    async (providerId: string, enterpriseDomain?: string) => {
      setOauthAuthenticating((prev) => ({ ...prev, [providerId]: true }));

      await startOauthPolling({
        key: providerId,
        start: () =>
          startProviderOauth({
            body: {
              provider: providerId,
              enterpriseDomain: enterpriseDomain || undefined,
            },
          }),
        poll: () => getProviderOauthStatus({ body: { provider: providerId } }),
        isStartSuccess: (result) => result.success,
        getStartAuthUrl: (result) => result.authUrl || undefined,
        getStartStatus: (result) => normalizeOAuthStatus(result.status),
        getStartError: (result) => result.error || 'Failed to start OAuth',
        getPollStatus: (result) => normalizeOAuthStatus(result.status),
        onStartResult: (result) => {
          applyProviderOauthStatus(providerId, {
            status: result.status,
            authUrl: result.authUrl,
            instructions: result.instructions,
            error: result.error,
          });
        },
        onPollResult: (result) => {
          applyProviderOauthStatus(providerId, result);
        },
        onAuthenticated: async () => {
          refreshModels?.();
        },
        onStartFailed: (reason) => {
          setOauthError(providerId, 'Failed to start OAuth', reason);
        },
        onError: (error) => {
          setOauthError(providerId, 'Failed to load OAuth status', error);
        },
        onFinish: () => {
          setOauthAuthenticating((prev) => ({ ...prev, [providerId]: false }));
        },
      });
    },
    [
      applyProviderOauthStatus,
      refreshModels,
      setOauthAuthenticating,
      setOauthError,
      startOauthPolling,
    ],
  );

  const submitOauthCode = useCallback(
    async (providerId: string, code: string) => {
      if (!code) return;

      setOauthSubmitting((prev) => ({ ...prev, [providerId]: true }));
      try {
        const result = await submitProviderOauthCode({ body: { provider: providerId, code } });
        if (!result.success) {
          setOauthError(providerId, 'Failed to submit code', result.error);
          return;
        }

        const status = await getProviderOauthStatus({ body: { provider: providerId } });
        const normalized = applyProviderOauthStatus(providerId, status);

        if (normalized === 'authenticated') {
          stopOauthPolling(providerId);
          setOauthAuthenticating((prev) => ({ ...prev, [providerId]: false }));
          refreshModels?.();
        } else if (normalized === 'error') {
          stopOauthPolling(providerId);
          setOauthAuthenticating((prev) => ({ ...prev, [providerId]: false }));
        }
      } catch (error) {
        setOauthError(providerId, 'Failed to submit code', error);
      } finally {
        setOauthSubmitting((prev) => ({ ...prev, [providerId]: false }));
      }
    },
    [
      applyProviderOauthStatus,
      refreshModels,
      setOauthAuthenticating,
      setOauthError,
      setOauthSubmitting,
      stopOauthPolling,
    ],
  );

  const revokeOauth = useCallback(
    async (providerId: string) => {
      stopOauthPolling(providerId);
      setOauthAuthenticating((prev) => ({ ...prev, [providerId]: false }));
      setOauthStatus((prev) => ({
        ...prev,
        [providerId]: {
          status: 'none',
          hasTokens: false,
          authUrl: undefined,
          instructions: undefined,
          error: undefined,
        },
      }));
      setOauthRevoking((prev) => ({ ...prev, [providerId]: true }));

      try {
        await revokeProviderOauth({ body: { provider: providerId } });
        refreshModels?.();
      } catch (error) {
        setOauthError(providerId, 'Failed to revoke OAuth', error);
      } finally {
        setOauthRevoking((prev) => ({ ...prev, [providerId]: false }));
      }
    },
    [
      refreshModels,
      setOauthAuthenticating,
      setOauthError,
      setOauthRevoking,
      setOauthStatus,
      stopOauthPolling,
    ],
  );

  return {
    stopPolling: stopOauthPolling,
    startOauth,
    submitOauthCode,
    revokeOauth,
  };
}
