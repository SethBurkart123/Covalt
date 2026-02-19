"use client";

import { api } from "@/lib/services/api";
import type { Message, MessageSibling } from "@/lib/types/chat";
import { getChatAgentConfig, type ChatAgentConfigResponse } from "@/python/api";

export interface PrefetchedChatData {
  messages?: Message[];
  siblings?: Record<string, MessageSibling[]>;
  agentConfig?: ChatAgentConfigResponse;
  fetchedAt: number;
}

const cache = new Map<string, PrefetchedChatData>();
const inflight = new Map<string, Promise<PrefetchedChatData>>();
const MAX_CACHE = 30;

function setCache(chatId: string, data: PrefetchedChatData) {
  const existing = cache.get(chatId);
  if (existing && existing.fetchedAt > data.fetchedAt) return;
  cache.set(chatId, data);
  if (cache.size <= MAX_CACHE) return;
  const oldestKey = cache.keys().next().value as string | undefined;
  if (oldestKey) cache.delete(oldestKey);
}

export function getPrefetchedChat(chatId: string): PrefetchedChatData | undefined {
  return cache.get(chatId);
}

export function clearPrefetchedChat(chatId: string): void {
  cache.delete(chatId);
  inflight.delete(chatId);
}

export function setPrefetchedChat(chatId: string, data: PrefetchedChatData): void {
  setCache(chatId, data);
}

export function getPrefetchPromise(
  chatId: string,
): Promise<PrefetchedChatData> | undefined {
  return inflight.get(chatId);
}

export async function prefetchChat(chatId: string): Promise<PrefetchedChatData | null> {
  if (!chatId || typeof window === "undefined") return null;

  const cached = cache.get(chatId);
  if (cached) return cached;

  const existing = inflight.get(chatId);
  if (existing) return existing;

  const promise = (async () => {
    const chat = await api.getChat(chatId);
    const messageIds = Array.from(new Set((chat.messages || []).map((m) => m.id)));

    const baseData: PrefetchedChatData = {
      messages: chat.messages || [],
      fetchedAt: Date.now(),
    };
    setCache(chatId, baseData);

    void (async () => {
      try {
        const [siblings, agentConfig] = await Promise.all([
          messageIds.length > 0
            ? api.getMessageSiblingsBatch(chatId, messageIds)
            : Promise.resolve({}),
          getChatAgentConfig({ body: { id: chatId } }),
        ]);
        setCache(chatId, {
          ...baseData,
          siblings,
          agentConfig,
          fetchedAt: baseData.fetchedAt,
        });
      } catch {
        // keep baseData cache if background fetch fails
      }
    })();

    return baseData;
  })();

  inflight.set(chatId, promise);

  try {
    return await promise;
  } finally {
    inflight.delete(chatId);
  }
}
