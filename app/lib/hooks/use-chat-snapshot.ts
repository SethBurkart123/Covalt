"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/services/api";
import {
  getPrefetchedChat,
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

  useEffect(() => {
    currentChatIdRef.current = chatId;
  }, [chatId, currentChatIdRef]);

  useEffect(() => {
    if (activeSubmissionChatIdRef.current) return;

    const isChatSwitch = prevChatIdRef.current !== chatId;
    prevChatIdRef.current = chatId;

    if (!chatId) {
      applySnapshot([], {});
      return;
    }

    const loadId = ++loadTokenRef.current;
    const prefetched = getPrefetchedChat(chatId);
    const prefetchedMessages = prefetched?.messages || [];
    const prefetchedSiblings = prefetched?.siblings || {};
    const hasAllSiblings =
      prefetchedMessages.length > 0
        ? prefetchedMessages.every((msg) => msg.id in prefetchedSiblings)
        : true;
    const isFresh = prefetched ? Date.now() - prefetched.fetchedAt < 2_000 : false;

    if (hasAllSiblings && isFresh) {
      applySnapshot(prefetchedMessages, prefetchedSiblings);
      return;
    }

    if (isChatSwitch) {
      applySnapshot([], {});
    }

    fetchSnapshot(chatId)
      .then(({ messages, siblings }) => {
        if (loadTokenRef.current !== loadId || currentChatIdRef.current !== chatId) return;
        applySnapshot(messages, siblings);
      })
      .catch((err) => {
        if (loadTokenRef.current !== loadId || currentChatIdRef.current !== chatId) return;
        console.error("Failed to load chat messages:", err);
        applySnapshot([], {});
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
