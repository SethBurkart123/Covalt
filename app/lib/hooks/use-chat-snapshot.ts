"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/services/api";
import {
  getPrefetchedChat,
  getInflightPrefetch,
  setPrefetchedChat,
} from "@/lib/services/chat-prefetch";
import type { Message, MessageSibling } from "@/lib/types/chat";
import type {
  ReloadMessages,
  UseChatInputRefs,
  UseChatInputState,
} from "@/lib/hooks/use-chat-input.types";

interface UseChatSnapshotParams {
  chatId: string;
  onStreamComplete: (callback: (chatId: string) => void) => () => void;
  refs: Pick<
    UseChatInputRefs,
    "activeSubmissionChatIdRef" | "loadTokenRef" | "currentChatIdRef" | "prevChatIdRef"
  >;
  state: Pick<UseChatInputState, "setBaseMessages" | "setMessageSiblings">;
}

interface UseChatSnapshotResult {
  triggerReload: () => void;
  reloadMessages: ReloadMessages;
}

export function useChatSnapshot({
  chatId,
  onStreamComplete,
  refs,
  state,
}: UseChatSnapshotParams): UseChatSnapshotResult {
  const { activeSubmissionChatIdRef, loadTokenRef, currentChatIdRef, prevChatIdRef } = refs;
  const { setBaseMessages, setMessageSiblings } = state;
  const [reloadTrigger, setReloadTrigger] = useState(0);

  const applySnapshot = useCallback(
    (messages: Message[], siblings: Record<string, MessageSibling[]>) => {
      setBaseMessages(messages);
      setMessageSiblings(siblings);
    },
    [setBaseMessages, setMessageSiblings],
  );

  const fetchSnapshot = useCallback(async (id: string) => {
    const fullChat = await api.getChat(id);
    const messages = fullChat.messages || [];
    const messageIds = Array.from(new Set(messages.map((msg) => msg.id)));
    const siblings: Record<string, MessageSibling[]> =
      messageIds.length > 0 ? await api.getMessageSiblingsBatch(id, messageIds) : {};

    const cached = getPrefetchedChat(id);
    setPrefetchedChat(id, {
      ...(cached ?? { fetchedAt: 0 }),
      messages,
      siblings,
      fetchedAt: Date.now(),
    });

    return { messages, siblings };
  }, []);

  const reloadMessages = useCallback<ReloadMessages>(
    async (id: string) => {
      const loadId = ++loadTokenRef.current;
      const { messages, siblings } = await fetchSnapshot(id);
      if (loadTokenRef.current !== loadId || currentChatIdRef.current !== id) return;
      applySnapshot(messages, siblings);
    },
    [applySnapshot, currentChatIdRef, fetchSnapshot, loadTokenRef],
  );

  currentChatIdRef.current = chatId;

  useEffect(() => {
    if (activeSubmissionChatIdRef.current) return;

    prevChatIdRef.current = chatId;

    if (!chatId) {
      applySnapshot([], {});
      return;
    }

    const loadId = ++loadTokenRef.current;
    const isStale = (id: string) =>
      loadTokenRef.current !== loadId || currentChatIdRef.current !== id;

    const prefetched = getPrefetchedChat(chatId);
    const isFresh = prefetched ? Date.now() - prefetched.fetchedAt < 5_000 : false;

    if (isFresh && prefetched?.messages?.length) {
      applySnapshot(prefetched.messages, prefetched.siblings || {});

      if (prefetched.siblings) return;

      const inflightPromise = getInflightPrefetch(chatId);
      if (inflightPromise) {
        inflightPromise
          .then((data) => {
            if (isStale(chatId)) return;
            applySnapshot(data.messages || prefetched.messages!, data.siblings || {});
          })
          .catch(() => {});
      } else {
        fetchSnapshot(chatId)
          .then(({ messages, siblings }) => {
            if (isStale(chatId)) return;
            applySnapshot(messages, siblings);
          })
          .catch(() => {});
      }
      return;
    }

    if (prefetched?.messages?.length) {
      applySnapshot(prefetched.messages, prefetched.siblings || {});
    }

    fetchSnapshot(chatId)
      .then(({ messages, siblings }) => {
        if (isStale(chatId)) return;
        applySnapshot(messages, siblings);
      })
      .catch((err) => {
        if (isStale(chatId)) return;
        console.error("Failed to load chat messages:", err);
        if (!prefetched?.messages?.length) applySnapshot([], {});
      });
  }, [
    activeSubmissionChatIdRef,
    applySnapshot,
    chatId,
    currentChatIdRef,
    fetchSnapshot,
    loadTokenRef,
    prevChatIdRef,
    reloadTrigger,
  ]);

  useEffect(() => {
    const unsubscribe = onStreamComplete((completedChatId) => {
      if (completedChatId === chatId) {
        reloadMessages(chatId).catch((err) => {
          console.error("Failed to reload messages after stream completion:", err);
        });
      }
    });
    return unsubscribe;
  }, [chatId, reloadMessages, onStreamComplete]);

  const triggerReload = useCallback(() => {
    setReloadTrigger((n) => n + 1);
  }, []);

  return { triggerReload, reloadMessages };
}
