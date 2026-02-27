import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import {
  getProviderOauthStatus,
  revokeProviderOauth,
  startProviderOauth,
  submitProviderOauthCode,
} from '@/python/api';
import type { OAuthState } from './types';
import { normalizeOAuthStatus } from './types';

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
  const pollIntervalRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const pollTimeoutRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const stopPolling = useCallback((providerKey?: string) => {
    const stopKey = (key: string) => {
      const interval = pollIntervalRef.current[key];
      if (interval) {
        clearInterval(interval);
        delete pollIntervalRef.current[key];
      }
      const timeout = pollTimeoutRef.current[key];
      if (timeout) {
        clearTimeout(timeout);
        delete pollTimeoutRef.current[key];
      }
    };

    if (providerKey) {
      stopKey(providerKey);
      return;
    }

    Object.keys(pollIntervalRef.current).forEach(stopKey);
    Object.keys(pollTimeoutRef.current).forEach(stopKey);
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const pollOauthStatus = useCallback(
    async (providerId: string) => {
      try {
        const status = await getProviderOauthStatus({ body: { provider: providerId } });
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

        if (normalized === 'authenticated') {
          stopPolling(providerId);
          setOauthAuthenticating((prev) => ({ ...prev, [providerId]: false }));
          refreshModels?.();
        } else if (normalized === 'error') {
          stopPolling(providerId);
          setOauthAuthenticating((prev) => ({ ...prev, [providerId]: false }));
        }
      } catch (error) {
        stopPolling(providerId);
        setOauthAuthenticating((prev) => ({ ...prev, [providerId]: false }));
        setOauthStatus((prev) => ({
          ...prev,
          [providerId]: {
            status: 'error',
            error: error instanceof Error ? error.message : 'Failed to load OAuth status',
          },
        }));
      }
    },
    [refreshModels, setOauthAuthenticating, setOauthStatus, stopPolling],
  );

  const startOauth = useCallback(
    async (providerId: string, enterpriseDomain?: string) => {
      setOauthAuthenticating((prev) => ({ ...prev, [providerId]: true }));
      stopPolling(providerId);

      try {
        const result = await startProviderOauth({
          body: {
            provider: providerId,
            enterpriseDomain: enterpriseDomain || undefined,
          },
        });

        if (!result.success) {
          setOauthStatus((prev) => ({
            ...prev,
            [providerId]: {
              status: 'error',
              error: result.error || 'Failed to start OAuth',
            },
          }));
          setOauthAuthenticating((prev) => ({ ...prev, [providerId]: false }));
          return;
        }

        const normalizedStatus = normalizeOAuthStatus(result.status);
        setOauthStatus((prev) => ({
          ...prev,
          [providerId]: {
            status: normalizedStatus,
            authUrl: result.authUrl,
            instructions: result.instructions,
            error: result.error,
          },
        }));

        if (result.authUrl) {
          openOauthWindow(result.authUrl);
        }

        if (normalizedStatus === 'authenticated') {
          setOauthAuthenticating((prev) => ({ ...prev, [providerId]: false }));
          refreshModels?.();
          return;
        }

        if (normalizedStatus === 'error') {
          setOauthAuthenticating((prev) => ({ ...prev, [providerId]: false }));
          return;
        }

        pollIntervalRef.current[providerId] = setInterval(() => {
          void pollOauthStatus(providerId);
        }, 2000);

        pollTimeoutRef.current[providerId] = setTimeout(() => {
          stopPolling(providerId);
          setOauthAuthenticating((prev) => ({ ...prev, [providerId]: false }));
        }, 5 * 60 * 1000);
      } catch (error) {
        setOauthStatus((prev) => ({
          ...prev,
          [providerId]: {
            status: 'error',
            error: error instanceof Error ? error.message : 'Failed to start OAuth',
          },
        }));
        setOauthAuthenticating((prev) => ({ ...prev, [providerId]: false }));
      }
    },
    [
      openOauthWindow,
      pollOauthStatus,
      refreshModels,
      setOauthAuthenticating,
      setOauthStatus,
      stopPolling,
    ],
  );

  const submitOauthCode = useCallback(
    async (providerId: string, code: string) => {
      if (!code) return;

      setOauthSubmitting((prev) => ({ ...prev, [providerId]: true }));
      try {
        const result = await submitProviderOauthCode({ body: { provider: providerId, code } });
        if (!result.success) {
          setOauthStatus((prev) => ({
            ...prev,
            [providerId]: {
              status: 'error',
              error: result.error || 'Failed to submit code',
            },
          }));
          return;
        }

        const status = await getProviderOauthStatus({ body: { provider: providerId } });
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

        if (normalized === 'authenticated') {
          stopPolling(providerId);
          setOauthAuthenticating((prev) => ({ ...prev, [providerId]: false }));
          refreshModels?.();
        } else if (normalized === 'error') {
          stopPolling(providerId);
          setOauthAuthenticating((prev) => ({ ...prev, [providerId]: false }));
        }
      } catch (error) {
        setOauthStatus((prev) => ({
          ...prev,
          [providerId]: {
            status: 'error',
            error: error instanceof Error ? error.message : 'Failed to submit code',
          },
        }));
      } finally {
        setOauthSubmitting((prev) => ({ ...prev, [providerId]: false }));
      }
    },
    [refreshModels, setOauthAuthenticating, setOauthStatus, setOauthSubmitting, stopPolling],
  );

  const revokeOauth = useCallback(
    async (providerId: string) => {
      stopPolling(providerId);
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
        setOauthStatus((prev) => ({
          ...prev,
          [providerId]: {
            status: 'error',
            error: error instanceof Error ? error.message : 'Failed to revoke OAuth',
          },
        }));
      } finally {
        setOauthRevoking((prev) => ({ ...prev, [providerId]: false }));
      }
    },
    [refreshModels, setOauthAuthenticating, setOauthRevoking, setOauthStatus, stopPolling],
  );

  return {
    stopPolling,
    startOauth,
    submitOauthCode,
    revokeOauth,
  };
}
