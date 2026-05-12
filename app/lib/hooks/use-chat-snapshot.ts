"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CHAT_MESSAGES_PAGE_SIZE } from "@/lib/chat-constants";
import { api } from "@/lib/services/api";
import {
  clearPrefetchedChat,
  getInflightPrefetch,
  getPrefetchedChat,
  setPrefetchedChat,
} from "@/lib/services/chat-prefetch";
import { isActivePhase, isTerminalPhase } from "@/lib/services/chat-run-machine";
import type { RunPhase, RunState } from "@/contexts/streaming-context";
import type { Message, MessageSibling } from "@/lib/types/chat";
import { chatMessagesToMessages } from "@/lib/types/chat-message-adapter";
import type {
  ReloadMessages,
  UseChatInputRefs,
  UseChatInputState,
} from "@/lib/hooks/use-chat-input.types";

type PageInfo = { hasMoreBefore?: boolean; nextBeforeCursor?: string | null };

function syncPrefetchCache(
  chatId: string,
  messages: Message[],
  siblings: Record<string, MessageSibling[]>,
  page: PageInfo,
) {
  const cached = getPrefetchedChat(chatId);
  setPrefetchedChat(chatId, {
    ...(cached ?? { fetchedAt: 0 }),
    messages,
    siblings: { ...(cached?.siblings || {}), ...siblings },
    hasMoreBefore: page.hasMoreBefore ?? false,
    nextBeforeCursor: page.nextBeforeCursor ?? null,
    fetchedAt: Date.now(),
  });
}

function prependOlderMessages(older: Message[], existing: Message[]): Message[] {
  const existingIds = new Set(existing.map((m) => m.id));
  return [...older.filter((m) => !existingIds.has(m.id)), ...existing];
}

interface UseChatSnapshotParams {
  chatId: string | null;
  getRunState: (chatId: string) => RunState | undefined;
  onPhaseChange: (
    callback: (chatId: string, phase: RunPhase, prevPhase: RunPhase) => void,
  ) => () => void;
  refs: Pick<
    UseChatInputRefs,
    "loadTokenRef" | "currentChatIdRef" | "prevChatIdRef"
  >;
  state: Pick<UseChatInputState, "setBaseMessages" | "setMessageSiblings">;
}

interface UseChatSnapshotResult {
  triggerReload: () => void;
  reloadMessages: ReloadMessages;
  loadMoreBefore: () => Promise<void>;
  hasMoreBefore: boolean;
  isLoadingMoreBefore: boolean;
}

export function useChatSnapshot({
  chatId,
  getRunState,
  onPhaseChange,
  refs,
  state,
}: UseChatSnapshotParams): UseChatSnapshotResult {
  const { loadTokenRef, currentChatIdRef, prevChatIdRef } = refs;
  const { setBaseMessages, setMessageSiblings } = state;
  const [reloadTrigger, setReloadTrigger] = useState(0);
  const [beforeCursor, setBeforeCursor] = useState<string | null>(null);
  const [hasMoreBefore, setHasMoreBefore] = useState(false);
  const [isLoadingMoreBefore, setIsLoadingMoreBefore] = useState(false);

  const getRunStateRef = useRef(getRunState);
  getRunStateRef.current = getRunState;

  const applySnapshot = useCallback(
    (
      messages: Message[],
      siblings: Record<string, MessageSibling[]>,
      page?: { hasMoreBefore?: boolean; nextBeforeCursor?: string | null },
    ) => {
      setBaseMessages(messages);
      setMessageSiblings(siblings);
      setHasMoreBefore(page?.hasMoreBefore ?? false);
      setBeforeCursor(page?.nextBeforeCursor ?? null);
    },
    [setBaseMessages, setMessageSiblings],
  );

  const fetchSnapshot = useCallback(async (id: string) => {
    const page = await api.getChatMessagesPage(id, CHAT_MESSAGES_PAGE_SIZE);
    const messages = chatMessagesToMessages(page.messages);
    const messageIds = Array.from(new Set(messages.map((msg) => msg.id)));
    const siblings: Record<string, MessageSibling[]> =
      messageIds.length > 0
        ? await api.getMessageSiblingsBatch(id, messageIds)
        : {};

    syncPrefetchCache(id, messages, siblings, page);
    return {
      messages,
      siblings,
      hasMoreBefore: page.hasMoreBefore,
      nextBeforeCursor: page.nextBeforeCursor,
    };
  }, []);

  const reloadMessages = useCallback<ReloadMessages>(
    async (id: string) => {
      if (currentChatIdRef.current === id) {
        clearPrefetchedChat(id);
      }

      const loadId = ++loadTokenRef.current;
      const page = await fetchSnapshot(id);
      if (loadTokenRef.current !== loadId || currentChatIdRef.current !== id)
        return;
      applySnapshot(page.messages, page.siblings, page);
    },
    [applySnapshot, currentChatIdRef, fetchSnapshot, loadTokenRef],
  );

  const loadMoreBefore = useCallback(async () => {
    if (!chatId || !beforeCursor || isLoadingMoreBefore || !hasMoreBefore) return;

    const requestedChatId = chatId;
    const isStale = () => currentChatIdRef.current !== requestedChatId;
    setIsLoadingMoreBefore(true);
    try {
      const page = await api.getChatMessagesPage(
        requestedChatId,
        CHAT_MESSAGES_PAGE_SIZE,
        beforeCursor,
      );
      const olderMessages = chatMessagesToMessages(page.messages);
      const messageIds = Array.from(new Set(olderMessages.map((msg) => msg.id)));
      const olderSiblings: Record<string, MessageSibling[]> =
        messageIds.length > 0
          ? await api.getMessageSiblingsBatch(requestedChatId, messageIds)
          : {};

      if (isStale()) return;

      setBaseMessages((prev) => {
        const merged = prependOlderMessages(olderMessages, prev);
        syncPrefetchCache(requestedChatId, merged, olderSiblings, page);
        return merged;
      });
      setMessageSiblings((prev) => ({ ...prev, ...olderSiblings }));
      setHasMoreBefore(page.hasMoreBefore ?? false);
      setBeforeCursor(page.nextBeforeCursor ?? null);
    } catch (error) {
      if (!isStale()) console.error("Failed to load older messages:", error);
    } finally {
      if (!isStale()) setIsLoadingMoreBefore(false);
    }
  }, [
    beforeCursor,
    chatId,
    currentChatIdRef,
    hasMoreBefore,
    isLoadingMoreBefore,
    setBaseMessages,
    setMessageSiblings,
  ]);

  currentChatIdRef.current = chatId;

  type StaleFn = (id: string) => boolean;

  const loadForActiveRun = (id: string, isStale: StaleFn) => {
    const prefetched = getPrefetchedChat(id);
    applySnapshot(
      prefetched?.messages?.length ? prefetched.messages : [],
      prefetched?.siblings || {},
      prefetched,
    );
    fetchSnapshot(id)
      .then((page) => {
        if (isStale(id)) return;
        applySnapshot(page.messages, page.siblings, page);
      })
      .catch((err) => {
        if (isStale(id)) return;
        console.error("Failed to load chat messages:", err);
      });
  };

  const loadFromFreshPrefetch = (
    id: string,
    isStale: StaleFn,
    prefetched: NonNullable<ReturnType<typeof getPrefetchedChat>>,
  ) => {
    applySnapshot(prefetched.messages!, prefetched.siblings || {}, prefetched);
    if (prefetched.siblings) return;

    const inflightPromise = getInflightPrefetch(id);
    const settle = inflightPromise ?? fetchSnapshot(id);
    settle
      .then((data) => {
        if (isStale(id)) return;
        applySnapshot(
          data.messages || prefetched.messages!,
          data.siblings || {},
          data,
        );
      })
      .catch(() => {});
  };

  const loadWithFetch = (
    id: string,
    isStale: StaleFn,
    prefetched: ReturnType<typeof getPrefetchedChat>,
  ) => {
    if (prefetched?.messages?.length) {
      applySnapshot(prefetched.messages, prefetched.siblings || {}, prefetched);
    }
    fetchSnapshot(id)
      .then((page) => {
        if (isStale(id)) return;
        applySnapshot(page.messages, page.siblings, page);
      })
      .catch((err) => {
        if (isStale(id)) return;
        console.error("Failed to load chat messages:", err);
        if (!prefetched?.messages?.length) applySnapshot([], {});
      });
  };

  useEffect(() => {
    prevChatIdRef.current = chatId;
    if (!chatId) {
      applySnapshot([], {});
      return;
    }

    setIsLoadingMoreBefore(false);
    const loadId = ++loadTokenRef.current;
    const isStale = (id: string) =>
      loadTokenRef.current !== loadId || currentChatIdRef.current !== id;

    const runState = getRunStateRef.current(chatId);
    if (runState && isActivePhase(runState.phase)) return loadForActiveRun(chatId, isStale);

    const prefetched = getPrefetchedChat(chatId);
    const isFresh = prefetched ? Date.now() - prefetched.fetchedAt < 5_000 : false;

    if (isFresh && prefetched?.messages?.length) return loadFromFreshPrefetch(chatId, isStale, prefetched);
    loadWithFetch(chatId, isStale, prefetched);
  }, [
    applySnapshot,
    chatId,
    currentChatIdRef,
    fetchSnapshot,
    loadTokenRef,
    prevChatIdRef,
    reloadTrigger,
  ]);

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = onPhaseChange((completedChatId, phase) => {
      if (completedChatId !== chatId || !isTerminalPhase(phase)) return;

      const startedAt = Date.now();
      const attempt = async () => {
        if (cancelled) return;
        if (currentChatIdRef.current !== chatId) return;

        const before = getPrefetchedChat(chatId)?.messages?.length ?? 0;

        try {
          await reloadMessages(chatId);
        } catch (err) {
          console.error(
            "Failed to reload messages after stream completion:",
            err,
          );
        }

        if (cancelled || currentChatIdRef.current !== chatId) return;

        const after = getPrefetchedChat(chatId)?.messages?.length ?? 0;
        const elapsed = Date.now() - startedAt;

        if (after <= before && elapsed < 6_000) {
          setTimeout(() => {
            void attempt();
          }, 400);
        }
      };

      setTimeout(() => {
        void attempt();
      }, 120);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [chatId, reloadMessages, onPhaseChange, currentChatIdRef]);

  const triggerReload = useCallback(() => {
    setReloadTrigger((n) => n + 1);
  }, []);

  return {
    triggerReload,
    reloadMessages,
    loadMoreBefore,
    hasMoreBefore,
    isLoadingMoreBefore,
  };
}
