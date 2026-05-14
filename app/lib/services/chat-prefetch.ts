
import { CHAT_MESSAGES_PAGE_SIZE } from "@/lib/chat-constants";
import { api } from "@/lib/services/api";
import type { Message, MessageSibling } from "@/lib/types/chat";
import { chatMessagesToMessages } from "@/lib/types/chat-message-adapter";
import { getChatAgentConfig, type ChatAgentConfigResponse } from "@/python/api";

interface PrefetchedChatData {
  messages?: Message[];
  siblings?: Record<string, MessageSibling[]>;
  agentConfig?: ChatAgentConfigResponse;
  hasMoreBefore?: boolean;
  nextBeforeCursor?: string | null;
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

export function getInflightPrefetch(chatId: string): Promise<PrefetchedChatData> | undefined {
  return inflight.get(chatId);
}

export async function prefetchChat(chatId: string): Promise<PrefetchedChatData | null> {
  if (!chatId || typeof window === "undefined") return null;

  const cached = cache.get(chatId);
  if (cached?.siblings) return cached;

  const existing = inflight.get(chatId);
  if (existing) return existing;

  const promise = (async () => {
    const page = await api.getChatMessagesPage(chatId, CHAT_MESSAGES_PAGE_SIZE);
    const messages = chatMessagesToMessages(page.messages);
    const messageIds = Array.from(new Set(messages.map((m) => m.id)));
    const fetchedAt = Date.now();
    const pageInfo = {
      hasMoreBefore: page.hasMoreBefore ?? false,
      nextBeforeCursor: page.nextBeforeCursor ?? null,
    };

    setCache(chatId, { messages, ...pageInfo, fetchedAt });

    const [siblings, agentConfig] = await Promise.all([
      messageIds.length > 0
        ? api.getMessageSiblingsBatch(chatId, messageIds)
        : Promise.resolve({} as Record<string, never>),
      getChatAgentConfig({ body: { id: chatId } }).catch(() => undefined),
    ]);

    const fullData: PrefetchedChatData = {
      messages,
      siblings,
      agentConfig,
      ...pageInfo,
      fetchedAt,
    };
    setCache(chatId, fullData);
    return fullData;
  })();

  inflight.set(chatId, promise);

  try {
    return await promise;
  } finally {
    inflight.delete(chatId);
  }
}
