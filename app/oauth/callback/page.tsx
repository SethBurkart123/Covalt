"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  initBridge,
  completeMcpOauthCallback,
  failMcpOauthCallback,
} from "@/python/api";

initBridge("http://127.0.0.1:8000");

type CallbackStatus = "processing" | "success" | "error";

export default function OAuthCallbackPage() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<CallbackStatus>("processing");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    async function handleCallback() {
      const code = searchParams.get("code");
      const state = searchParams.get("state");
      const error = searchParams.get("error");
      const errorDescription = searchParams.get("error_description");

      if (error) {
        if (state) {
          await failMcpOauthCallback({
            body: {
              state,
              error,
              errorDescription: errorDescription ?? undefined,
            },
          });
        }
        setErrorMessage(errorDescription || error);
        setStatus("error");
        return;
      }

      if (!code || !state) {
        setErrorMessage("Missing authorization code or state parameter");
        setStatus("error");
        return;
      }

      try {
        const result = await completeMcpOauthCallback({
          body: { code, state },
        });

        if (result.success) {
          setStatus("success");
          window.close();
        } else {
          setErrorMessage(result.error || "Failed to complete authentication");
          setStatus("error");
        }
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Unknown error");
        setStatus("error");
      }
    }

    handleCallback();
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center max-w-md px-6">
        {status === "processing" && (
          <>
            <div className="w-16 h-16 mx-auto mb-6 rounded-full border-4 border-muted border-t-primary animate-spin" />
            <h1 className="text-2xl font-semibold text-foreground mb-2">
              Completing Authentication
            </h1>
            <p className="text-muted-foreground">Please wait...</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-green-500/10 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-green-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-semibold text-foreground mb-2">
              Authentication Successful!
            </h1>
            <p className="text-muted-foreground">
              You can close this window and return to Agno.
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-500/10 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-red-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-semibold text-foreground mb-2">
              Authentication Failed
            </h1>
            <p className="text-muted-foreground mb-4">{errorMessage}</p>
            <p className="text-sm text-muted-foreground">
              You can close this window and try again.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
