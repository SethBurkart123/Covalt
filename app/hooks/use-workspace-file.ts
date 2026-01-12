import { useState, useEffect, useCallback } from "react";
import { getWorkspaceFile as fetchWorkspaceFileAPI } from "@/python/api";

async function fetchWorkspaceFile(chatId: string, path: string): Promise<string> {
  const response = await fetchWorkspaceFileAPI({ body: { chatId, path } });
  return atob(response.content);
}

interface UseWorkspaceFileResult {
  content: string | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Hook to fetch a file from a chat's workspace.
 * Returns the file content as a string (decoded from base64).
 */
export function useWorkspaceFile(
  chatId: string | undefined,
  filePath: string | undefined
): UseWorkspaceFileResult {
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  useEffect(() => {
    if (!chatId || !filePath) {
      setContent(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetchWorkspaceFile(chatId, filePath)
      .then((decoded) => {
        if (cancelled) return;
        setContent(decoded);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message || "Failed to fetch file");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [chatId, filePath, refetchTrigger]);

  const refetch = useCallback(() => setRefetchTrigger((t) => t + 1), []);

  return { content, isLoading, error, refetch };
}
