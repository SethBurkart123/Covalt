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

interface OauthUiPatch {
  authenticating?: boolean;
  submitting?: boolean;
  revoking?: boolean;
}

interface UseProviderOauthActionsParams {
  setOauthStatus: Dispatch<SetStateAction<Record<string, OAuthState>>>;
  patchOauthUi: (providerId: string, patch: OauthUiPatch) => void;
  refreshModels?: () => Promise<void> | void;
  openOauthWindow: (url: string) => void;
}

export function useProviderOauthActions({
  setOauthStatus,
  patchOauthUi,
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
      patchOauthUi(providerId, { authenticating: true });

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
          patchOauthUi(providerId, { authenticating: false });
        },
      });
    },
    [applyProviderOauthStatus, patchOauthUi, refreshModels, setOauthError, startOauthPolling],
  );

  const submitOauthCode = useCallback(
    async (providerId: string, code: string) => {
      if (!code) return;

      patchOauthUi(providerId, { submitting: true });
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
          patchOauthUi(providerId, { authenticating: false });
          refreshModels?.();
        } else if (normalized === 'error') {
          stopOauthPolling(providerId);
          patchOauthUi(providerId, { authenticating: false });
        }
      } catch (error) {
        setOauthError(providerId, 'Failed to submit code', error);
      } finally {
        patchOauthUi(providerId, { submitting: false });
      }
    },
    [
      applyProviderOauthStatus,
      patchOauthUi,
      refreshModels,
      setOauthError,
      stopOauthPolling,
    ],
  );

  const revokeOauth = useCallback(
    async (providerId: string) => {
      stopOauthPolling(providerId);
      patchOauthUi(providerId, { authenticating: false });
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
      patchOauthUi(providerId, { revoking: true });

      try {
        await revokeProviderOauth({ body: { provider: providerId } });
        refreshModels?.();
      } catch (error) {
        setOauthError(providerId, 'Failed to revoke OAuth', error);
      } finally {
        patchOauthUi(providerId, { revoking: false });
      }
    },
    [patchOauthUi, refreshModels, setOauthError, setOauthStatus, stopOauthPolling],
  );

  return {
    stopPolling: stopOauthPolling,
    startOauth,
    submitOauthCode,
    revokeOauth,
  };
}
