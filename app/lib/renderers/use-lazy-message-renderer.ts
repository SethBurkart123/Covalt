
import { useEffect, useState } from "react";
import type { MessageRenderer } from "./contracts";
import { getMessageRenderer } from "./registry";

const cache = new Map<string, Promise<MessageRenderer | null>>();

function loadRenderer(key: string): Promise<MessageRenderer | null> {
  const cached = cache.get(key);
  if (cached) return cached;
  const def = getMessageRenderer(key);
  if (!def?.message) {
    const empty = Promise.resolve<MessageRenderer | null>(null);
    cache.set(key, empty);
    return empty;
  }
  const promise = def
    .message()
    .then((mod) => mod.default)
    .catch((error) => {
      console.error(`[MessageRenderers] Failed to load '${key}'`, error);
      return null;
    });
  cache.set(key, promise);
  return promise;
}

export function useLazyMessageRenderer(key: string): MessageRenderer | null {
  const [component, setComponent] = useState<MessageRenderer | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadRenderer(key).then((c) => {
      if (!cancelled) setComponent(() => c);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return component;
}
