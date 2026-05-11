"use client";

import { useCallback, type Dispatch, type SetStateAction } from "react";
import { api } from "@/lib/services/api";
import {
  getPrefetchedChat,
  setPrefetchedChat,
} from "@/lib/services/chat-prefetch";
import { processMessageStream } from "@/lib/services/stream-processor";
import { getOutputSmoothingConfig } from "@/lib/services/output-smoothing-settings";
import { createErrorMessage, createUserMessage } from "@/lib/utils/message";
import type { Attachment, Message } from "@/lib/types/chat";
import { runtimeEventToRunEvent } from "@/lib/services/chat-run-machine";
import type {
  PreserveStreamingMessage,
  ReloadMessages,
  TrackModel,
  UseChatInputContext,
  UseChatInputOptions,
  UseChatInputRefs,
} from "@/lib/hooks/use-chat-input.types";

function seedPrefetchWithLocalHistory(
  chatId: string,
  localMessages: Message[],
): void {
  if (!chatId || localMessages.length === 0) return;
  const existing = getPrefetchedChat(chatId);
  if (existing?.siblings) return;
  setPrefetchedChat(chatId, {
    ...(existing ?? {}),
    messages: localMessages,
    fetchedAt: Date.now(),
  });
}

interface UseChatStreamActionsParams {
  context: Pick<
    UseChatInputContext,
    | "chatId"
    | "selectedModel"
    | "refreshChats"
    | "activeToolIds"
    | "setChatToolIds"
    | "startRun"
    | "completeRun"
    | "getRunState"
    | "dispatchRunEvent"
  >;
  options: UseChatInputOptions;
  refs: Pick<UseChatInputRefs, "streamAbortRef" | "selectedModelRef" | "currentChatIdRef">;
  baseMessages: Message[];
  setBaseMessages: Dispatch<SetStateAction<Message[]>>;
  isLoading: boolean;
  canSendMessage: boolean;
  preserveStreamingMessage: PreserveStreamingMessage;
  reloadMessages: ReloadMessages;
  trackModel: TrackModel;
}

export function useChatStreamActions({
  context,
  options,
  refs,
  baseMessages,
  setBaseMessages,
  isLoading,
  canSendMessage,
  preserveStreamingMessage,
  reloadMessages,
  trackModel,
}: UseChatStreamActionsParams) {
  const {
    chatId,
    selectedModel,
    refreshChats,
    activeToolIds,
    setChatToolIds,
    startRun,
    completeRun,
    getRunState,
    dispatchRunEvent,
  } = context;
  const { onThinkTagDetected, getVisibleModelOptions, getVisibleVariables } = options;
  const { streamAbortRef, selectedModelRef, currentChatIdRef } = refs;

  const isStillForeground = useCallback(
    (targetChatId: string) => currentChatIdRef.current === targetChatId,
    [currentChatIdRef],
  );

  const handleSubmit = useCallback(
    async (
      inputText: string,
      attachments: Attachment[],
      extraToolIds?: string[],
    ) => {
      if (
        (!inputText.trim() && attachments.length === 0) ||
        isLoading ||
        !canSendMessage
      )
        return;

      const mergedToolIds = extraToolIds?.length
        ? Array.from(new Set([...activeToolIds, ...extraToolIds]))
        : activeToolIds;
      const hasNewToolIds =
        extraToolIds?.some((id) => !activeToolIds.includes(id)) ?? false;

      if (hasNewToolIds) {
        void setChatToolIds(mergedToolIds, { persistDefaults: false });
      }

      const userMessage = createUserMessage(inputText.trim(), attachments);
      const newBaseMessages = [...baseMessages, userMessage];
      setBaseMessages(newBaseMessages);

      let sessionId: string | null = null;
      const modelOptions = getVisibleModelOptions?.();
      const variables = getVisibleVariables?.();
      const outputSmoothing = await getOutputSmoothingConfig();

      if (chatId) {
        startRun(chatId, { subscribe: !outputSmoothing.enabled });
        seedPrefetchWithLocalHistory(chatId, newBaseMessages);
      }

      try {
        const { response, abort } = api.streamChat(
          newBaseMessages,
          selectedModel,
          chatId || undefined,
          mergedToolIds,
          attachments.length > 0 ? attachments : undefined,
          modelOptions,
          variables,
        );
        streamAbortRef.current = abort;

        if (!response.ok)
          throw new Error(`Failed to stream chat: ${response.statusText}`);

        const result = await processMessageStream(
          response,
          {
            onUpdate: (content) => {
              const currentChatId = sessionId || chatId;
              if (currentChatId) {
                dispatchRunEvent(currentChatId, {
                  type: "CONTENT_UPDATE",
                  content,
                });
              }
            },
            onSessionId: async (id) => {
              sessionId = id;
              if (id) {
                if (!chatId) {
                  startRun(id, { subscribe: !outputSmoothing.enabled });
                  seedPrefetchWithLocalHistory(id, newBaseMessages);
                  window.history.replaceState(null, "", `/?chatId=${id}`);
                  refreshChats();
                  api
                    .generateChatTitle(id)
                    .then(refreshChats)
                    .catch(console.error);
                } else {
                  dispatchRunEvent(chatId, { type: "SESSION_ID", chatId: id });
                }
              }
            },
            onMessageId: (id) => {
              const currentChatId = sessionId || chatId;
              if (currentChatId) {
                dispatchRunEvent(currentChatId, {
                  type: "MESSAGE_ID",
                  messageId: id,
                });
              }
            },
            onEvent: (eventType, payload) => {
              const currentChatId = sessionId || chatId;
              if (!currentChatId) return;
              const runEvent = runtimeEventToRunEvent(eventType, payload);
              if (runEvent) dispatchRunEvent(currentChatId, runEvent);
            },
            onThinkTagDetected,
          },
          undefined,
          {
            smoothOutput: outputSmoothing.enabled,
            outputSmoothingDelayMs: outputSmoothing.delayMs,
          },
        );

        const finalChatId = sessionId || chatId;
        if (finalChatId) {
          trackModel();
          if (isStillForeground(finalChatId)) preserveStreamingMessage(result);
          completeRun(finalChatId);
        }
      } catch (error) {
        console.error("Error streaming chat:", error);
        const finalChatId = sessionId || chatId;
        if (finalChatId) {
          dispatchRunEvent(finalChatId, {
            type: "ERROR",
            message: String(error),
          });
          completeRun(finalChatId);
          if (isStillForeground(finalChatId)) {
            await reloadMessages(finalChatId).catch(() => {});
          }
        }
        if (!finalChatId && currentChatIdRef.current === chatId) {
          setBaseMessages([...newBaseMessages, createErrorMessage(error)]);
        }
      } finally {
        streamAbortRef.current = null;
      }
    },
    [
      activeToolIds,
      baseMessages,
      canSendMessage,
      chatId,
      completeRun,
      currentChatIdRef,
      dispatchRunEvent,
      getVisibleModelOptions,
      getVisibleVariables,
      isLoading,
      isStillForeground,
      onThinkTagDetected,
      preserveStreamingMessage,
      refreshChats,
      reloadMessages,
      selectedModel,
      setBaseMessages,
      setChatToolIds,
      startRun,
      streamAbortRef,
      trackModel,
    ],
  );

  const handleContinue = useCallback(
    async (messageId: string) => {
      if (!chatId) return;

      const idx = baseMessages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;

      const outputSmoothing = await getOutputSmoothingConfig();
      startRun(chatId, { subscribe: !outputSmoothing.enabled });
      const truncated = baseMessages.slice(0, idx);
      setBaseMessages(truncated);
      seedPrefetchWithLocalHistory(chatId, truncated);

      try {
        const currentModel = selectedModelRef.current || undefined;
        const modelOptions = getVisibleModelOptions?.();
        const variables = getVisibleVariables?.();
        const { response, abort } = api.continueMessage(
          messageId,
          chatId,
          currentModel,
          activeToolIds,
          modelOptions,
          variables,
        );
        streamAbortRef.current = abort;

        const result = await processMessageStream(
          response,
          {
            onUpdate: (content) => {
              dispatchRunEvent(chatId, { type: "CONTENT_UPDATE", content });
            },
            onMessageId: (id) => {
              dispatchRunEvent(chatId, { type: "MESSAGE_ID", messageId: id });
            },
            onEvent: (eventType, payload) => {
              const runEvent = runtimeEventToRunEvent(eventType, payload);
              if (runEvent) dispatchRunEvent(chatId, runEvent);
            },
            onThinkTagDetected,
          },
          undefined,
          {
            smoothOutput: outputSmoothing.enabled,
            outputSmoothingDelayMs: outputSmoothing.delayMs,
          },
        );

        if (isStillForeground(chatId)) preserveStreamingMessage(result);
        completeRun(chatId);
        trackModel(baseMessages[idx]?.modelUsed);
      } catch (error) {
        console.error("Failed to continue message:", error);
        dispatchRunEvent(chatId, { type: "ERROR", message: String(error) });
        completeRun(chatId);
        if (isStillForeground(chatId)) {
          await reloadMessages(chatId).catch(() => {});
        }
      }
    },
    [
      activeToolIds,
      baseMessages,
      chatId,
      completeRun,
      dispatchRunEvent,
      getVisibleModelOptions,
      getVisibleVariables,
      isStillForeground,
      onThinkTagDetected,
      preserveStreamingMessage,
      reloadMessages,
      selectedModelRef,
      setBaseMessages,
      startRun,
      streamAbortRef,
      trackModel,
    ],
  );

  const handleRetry = useCallback(
    async (messageId: string) => {
      if (!chatId) return;

      const idx = baseMessages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;

      const truncated = baseMessages.slice(0, idx);
      setBaseMessages(truncated);
      const outputSmoothing = await getOutputSmoothingConfig();
      startRun(chatId, { subscribe: !outputSmoothing.enabled });
      seedPrefetchWithLocalHistory(chatId, truncated);

      try {
        const currentModel = selectedModelRef.current || undefined;
        const modelOptions = getVisibleModelOptions?.();
        const variables = getVisibleVariables?.();
        const { response, abort } = api.retryMessage(
          messageId,
          chatId,
          currentModel,
          activeToolIds,
          modelOptions,
          variables,
        );
        streamAbortRef.current = abort;

        const result = await processMessageStream(
          response,
          {
            onUpdate: (content) => {
              dispatchRunEvent(chatId, { type: "CONTENT_UPDATE", content });
            },
            onMessageId: (id) => {
              dispatchRunEvent(chatId, { type: "MESSAGE_ID", messageId: id });
            },
            onEvent: (eventType, payload) => {
              const runEvent = runtimeEventToRunEvent(eventType, payload);
              if (runEvent) dispatchRunEvent(chatId, runEvent);
            },
            onThinkTagDetected,
          },
          undefined,
          {
            smoothOutput: outputSmoothing.enabled,
            outputSmoothingDelayMs: outputSmoothing.delayMs,
          },
        );

        if (isStillForeground(chatId)) preserveStreamingMessage(result);
        completeRun(chatId);
        trackModel();
      } catch (error) {
        console.error("Failed to retry message:", error);
        dispatchRunEvent(chatId, { type: "ERROR", message: String(error) });
        completeRun(chatId);
        if (isStillForeground(chatId)) {
          await reloadMessages(chatId).catch(() => {});
        }
      }
    },
    [
      activeToolIds,
      baseMessages,
      chatId,
      completeRun,
      dispatchRunEvent,
      getVisibleModelOptions,
      getVisibleVariables,
      isStillForeground,
      onThinkTagDetected,
      preserveStreamingMessage,
      reloadMessages,
      selectedModelRef,
      setBaseMessages,
      startRun,
      streamAbortRef,
      trackModel,
    ],
  );

  const handleStop = useCallback(async () => {
    streamAbortRef.current?.();
    streamAbortRef.current = null;

    const finalChatId = chatId;
    if (!finalChatId) return;

    const runState = getRunState(finalChatId);
    const messageId = runState?.messageId;
    if (messageId) {
      try {
        await api.cancelRun(messageId);
      } catch (error) {
        console.error("Error cancelling run:", error);
      }
    }
    dispatchRunEvent(finalChatId, { type: "CANCELLED" });
    completeRun(finalChatId);
    if (isStillForeground(finalChatId)) {
      await reloadMessages(finalChatId).catch(() => {});
    }
  }, [
    chatId,
    completeRun,
    dispatchRunEvent,
    getRunState,
    isStillForeground,
    reloadMessages,
    streamAbortRef,
  ]);

  return {
    handleSubmit,
    handleContinue,
    handleRetry,
    handleStop,
  };
}
