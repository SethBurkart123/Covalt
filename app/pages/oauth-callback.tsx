import { useEffect, useState } from "react";
import { useSearch } from "@tanstack/react-router";
import {
  initZynk,
  completeMcpOauthCallback,
  failMcpOauthCallback,
} from "@/python/api";
import { getBackendBaseUrl } from "@/lib/services/backend-url";

type CallbackStatus = "processing" | "success" | "error";

function OAuthCallbackPageContent() {
  const search = useSearch({ from: "/oauth/callback" });
  const [status, setStatus] = useState<CallbackStatus>("processing");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    async function handleCallback() {
      initZynk({ baseUrl: getBackendBaseUrl() });
      const code = search.code ?? null;
      const state = search.state ?? null;
      const error = search.error ?? null;
      const errorDescription = search.error_description ?? null;

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
  }, [search]);

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
              You can close this window and return to Covalt.
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

export default function OAuthCallbackPage() {
  return <OAuthCallbackPageContent />;
}
