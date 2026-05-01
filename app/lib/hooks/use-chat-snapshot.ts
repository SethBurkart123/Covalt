"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/services/api";
import { beginChatOpen, mark } from "@/lib/services/chat-profiler";
import {
  clearPrefetchedChat,
  getInflightPrefetch,
  getPrefetchedChat,
  setPrefetchedChat,
} from "@/lib/services/chat-prefetch";
import { isActivePhase, isTerminalPhase } from "@/lib/services/chat-run-machine";
import type { RunPhase, RunState } from "@/contexts/streaming-context";
import type { Message, MessageSibling } from "@/lib/types/chat";
import type {
  ReloadMessages,
  UseChatInputRefs,
  UseChatInputState,
} from "@/lib/hooks/use-chat-input.types";

interface UseChatSnapshotParams {
  chatId: string;
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

  const getRunStateRef = useRef(getRunState);
  getRunStateRef.current = getRunState;

  const applySnapshot = useCallback(
    (messages: Message[], siblings: Record<string, MessageSibling[]>) => {
      mark(`applySnapshot(${messages.length})`);
      setBaseMessages(messages);
      setMessageSiblings(siblings);
    },
    [setBaseMessages, setMessageSiblings],
  );

  const fetchSnapshot = useCallback(async (id: string) => {
    mark("getChat:start");
    const fullChat = await api.getChat(id);
    mark("getChat:done");
    const messages = fullChat.messages || [];
    const messageIds = Array.from(new Set(messages.map((msg) => msg.id)));
    mark("siblingsBatch:start");
    const siblings: Record<string, MessageSibling[]> =
      messageIds.length > 0
        ? await api.getMessageSiblingsBatch(id, messageIds)
        : {};
    mark("siblingsBatch:done");

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
      if (currentChatIdRef.current === id) {
        clearPrefetchedChat(id);
      }

      const loadId = ++loadTokenRef.current;
      const { messages, siblings } = await fetchSnapshot(id);
      if (loadTokenRef.current !== loadId || currentChatIdRef.current !== id)
        return;
      applySnapshot(messages, siblings);
    },
    [applySnapshot, currentChatIdRef, fetchSnapshot, loadTokenRef],
  );

  currentChatIdRef.current = chatId;

  useEffect(() => {
    prevChatIdRef.current = chatId;

    if (!chatId) {
      applySnapshot([], {});
      return;
    }

    beginChatOpen(chatId);

    const loadId = ++loadTokenRef.current;
    const isStale = (id: string) =>
      loadTokenRef.current !== loadId || currentChatIdRef.current !== id;

    const runState = getRunStateRef.current(chatId);
    const hasActiveRun = runState ? isActivePhase(runState.phase) : false;

    if (hasActiveRun) {
      const prefetchedForActive = getPrefetchedChat(chatId);
      if (prefetchedForActive?.messages?.length) {
        applySnapshot(
          prefetchedForActive.messages,
          prefetchedForActive.siblings || {},
        );
      } else {
        applySnapshot([], {});
      }
      fetchSnapshot(chatId)
        .then(({ messages, siblings }) => {
          if (isStale(chatId)) return;
          applySnapshot(messages, siblings);
        })
        .catch((err) => {
          if (isStale(chatId)) return;
          console.error("Failed to load chat messages:", err);
        });
      return;
    }

    const prefetched = getPrefetchedChat(chatId);
    const isFresh = prefetched
      ? Date.now() - prefetched.fetchedAt < 5_000
      : false;

    if (isFresh && prefetched?.messages?.length) {
      applySnapshot(prefetched.messages, prefetched.siblings || {});

      if (prefetched.siblings) return;

      const inflightPromise = getInflightPrefetch(chatId);
      if (inflightPromise) {
        inflightPromise
          .then((data) => {
            if (isStale(chatId)) return;
            applySnapshot(
              data.messages || prefetched.messages!,
              data.siblings || {},
            );
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

  return { triggerReload, reloadMessages };
}
