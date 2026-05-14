
import { useCallback, useEffect, useRef } from "react";
import { openOauthPopup } from "@/lib/hooks/use-oauth-popup";

interface StartOauthPollingOptions<TStartResult, TPollResult> {
  key: string;
  start: () => Promise<TStartResult>;
  poll: () => Promise<TPollResult>;
  getStartAuthUrl: (result: TStartResult) => string | undefined;
  getPollStatus: (result: TPollResult) => unknown;
  isStartSuccess?: (result: TStartResult) => boolean;
  getStartStatus?: (result: TStartResult) => unknown;
  getStartError?: (result: TStartResult) => string | undefined;
  isAuthenticatedStatus?: (status: unknown) => boolean;
  isErrorStatus?: (status: unknown) => boolean;
  onStartResult?: (result: TStartResult) => void;
  onPollResult?: (result: TPollResult) => void;
  onAuthenticated?: () => Promise<void> | void;
  onStartFailed?: (reason?: string) => void;
  onError?: (error: unknown) => void;
  onFinish?: () => void;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export function useOauthPolling(openOauthWindow: (url: string) => void = openOauthPopup) {
  const pollIntervalsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const pollTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const stopOauthPolling = useCallback((key?: string) => {
    const stopKey = (stopTarget: string) => {
      const interval = pollIntervalsRef.current[stopTarget];
      if (interval) {
        clearInterval(interval);
        delete pollIntervalsRef.current[stopTarget];
      }

      const timeout = pollTimeoutsRef.current[stopTarget];
      if (timeout) {
        clearTimeout(timeout);
        delete pollTimeoutsRef.current[stopTarget];
      }
    };

    if (key) {
      stopKey(key);
      return;
    }

    Object.keys(pollIntervalsRef.current).forEach(stopKey);
    Object.keys(pollTimeoutsRef.current).forEach(stopKey);
  }, []);

  useEffect(() => {
    return () => stopOauthPolling();
  }, [stopOauthPolling]);

  const startOauthPolling = useCallback(
    async <TStartResult, TPollResult>({
      key,
      start,
      poll,
      getStartAuthUrl,
      getPollStatus,
      isStartSuccess = () => true,
      getStartStatus,
      getStartError,
      isAuthenticatedStatus = (status: unknown) => status === "authenticated",
      isErrorStatus = (status: unknown) => status === "error",
      onStartResult,
      onPollResult,
      onAuthenticated,
      onStartFailed,
      onError,
      onFinish,
      pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
      timeoutMs = DEFAULT_TIMEOUT_MS,
    }: StartOauthPollingOptions<TStartResult, TPollResult>): Promise<boolean> => {
      const finish = () => {
        onFinish?.();
      };

      const failStart = (reason?: string) => {
        onStartFailed?.(reason);
        finish();
      };

      const pollOnce = async (): Promise<void> => {
        try {
          const pollResult = await poll();
          onPollResult?.(pollResult);

          const status = getPollStatus(pollResult);
          if (!status) {
            return;
          }

          if (isAuthenticatedStatus(status)) {
            stopOauthPolling(key);
            await onAuthenticated?.();
            finish();
            return;
          }

          if (isErrorStatus(status)) {
            stopOauthPolling(key);
            finish();
          }
        } catch (error) {
          stopOauthPolling(key);
          onError?.(error);
          finish();
        }
      };

      stopOauthPolling(key);

      try {
        const startResult = await start();
        onStartResult?.(startResult);

        if (!isStartSuccess(startResult)) {
          failStart(getStartError?.(startResult));
          return false;
        }

        const authUrl = getStartAuthUrl(startResult);
        if (!authUrl) {
          failStart(getStartError?.(startResult));
          return false;
        }

        openOauthWindow(authUrl);

        const startStatus = getStartStatus?.(startResult);
        if (startStatus) {
          if (isAuthenticatedStatus(startStatus)) {
            await onAuthenticated?.();
            finish();
            return true;
          }

          if (isErrorStatus(startStatus)) {
            finish();
            return true;
          }
        }

        pollIntervalsRef.current[key] = setInterval(() => {
          void pollOnce();
        }, pollIntervalMs);

        pollTimeoutsRef.current[key] = setTimeout(() => {
          stopOauthPolling(key);
          finish();
        }, timeoutMs);

        return true;
      } catch (error) {
        stopOauthPolling(key);
        onError?.(error);
        finish();
        return false;
      }
    },
    [openOauthWindow, stopOauthPolling],
  );

  return {
    startOauthPolling,
    stopOauthPolling,
  };
}
