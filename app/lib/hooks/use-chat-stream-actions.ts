"use client";

import { useCallback, type Dispatch, type SetStateAction } from "react";
import { api } from "@/lib/services/api";
import { processMessageStream } from "@/lib/services/stream-processor";
import {
  createErrorMessage,
  createUserMessage,
} from "@/lib/utils/message";
import type { Attachment, Message } from "@/lib/types/chat";
import type {
  PreserveStreamingMessage,
  ReloadMessages,
  TrackModel,
  UseChatInputContext,
  UseChatInputOptions,
  UseChatInputRefs,
} from "@/lib/hooks/use-chat-input.types";

interface UseChatStreamActionsParams {
  context: Pick<
    UseChatInputContext,
    | "chatId"
    | "selectedModel"
    | "refreshChats"
    | "activeToolIds"
    | "setChatToolIds"
    | "registerStream"
    | "unregisterStream"
    | "updateStreamContent"
  >;
  options: UseChatInputOptions;
  refs: Pick<
    UseChatInputRefs,
    "streamingMessageIdRef" | "streamAbortRef" | "selectedModelRef" | "activeSubmissionChatIdRef"
  >;
  baseMessages: Message[];
  setBaseMessages: Dispatch<SetStateAction<Message[]>>;
  setSubmissionChatId: Dispatch<SetStateAction<string | null>>;
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
  setSubmissionChatId,
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
    registerStream,
    unregisterStream,
    updateStreamContent,
  } = context;
  const { onThinkTagDetected, getVisibleModelOptions } = options;
  const { streamingMessageIdRef, streamAbortRef, selectedModelRef, activeSubmissionChatIdRef } = refs;

  const handleSubmit = useCallback(
    async (inputText: string, attachments: Attachment[], extraToolIds?: string[]) => {
      if ((!inputText.trim() && attachments.length === 0) || isLoading || !canSendMessage) return;

      const mergedToolIds = extraToolIds?.length
        ? Array.from(new Set([...activeToolIds, ...extraToolIds]))
        : activeToolIds;
      const hasNewToolIds = extraToolIds?.some((id) => !activeToolIds.includes(id)) ?? false;

      if (hasNewToolIds) {
        void setChatToolIds(mergedToolIds, { persistDefaults: false });
      }

      const userMessage = createUserMessage(inputText.trim(), attachments);
      const newBaseMessages = [...baseMessages, userMessage];

      setBaseMessages(newBaseMessages);

      let sessionId: string | null = null;
      const modelOptions = getVisibleModelOptions?.();

      try {
        const { response, abort } = api.streamChat(
          newBaseMessages,
          selectedModel,
          chatId || undefined,
          mergedToolIds,
          attachments.length > 0 ? attachments : undefined,
          modelOptions,
        );
        streamAbortRef.current = abort;

        if (!response.ok) throw new Error(`Failed to stream chat: ${response.statusText}`);

        const result = await processMessageStream(response, {
          onUpdate: (content) => {
            const currentSessionId = sessionId || chatId;
            if (currentSessionId) {
              updateStreamContent(currentSessionId, content);
            }
          },
          onSessionId: async (id) => {
            sessionId = id;
            if (id) {
              activeSubmissionChatIdRef.current = id;
              setSubmissionChatId(id);
            }
            if (!chatId && id) {
              window.history.replaceState(null, "", `/?chatId=${id}`);
              refreshChats();
              api.generateChatTitle(id).then(refreshChats).catch(console.error);
            }
            if (id && streamingMessageIdRef.current) {
              registerStream(id, streamingMessageIdRef.current);
            }
          },
          onMessageId: (id) => {
            streamingMessageIdRef.current = id;
            const currentSessionId = sessionId || chatId;
            if (currentSessionId) {
              registerStream(currentSessionId, id);
            }
          },
          onThinkTagDetected,
        });

        const finalChatId = sessionId || chatId;
        if (finalChatId) {
          trackModel();
          preserveStreamingMessage(result);
          unregisterStream(finalChatId);
        }
      } catch (error) {
        console.error("Error streaming chat:", error);
        const finalChatId = sessionId || chatId;
        if (finalChatId) {
          unregisterStream(finalChatId);
          await reloadMessages(finalChatId).catch(() => {});
        }
        if (!finalChatId) {
          setBaseMessages([...newBaseMessages, createErrorMessage(error)]);
        }
      } finally {
        streamingMessageIdRef.current = null;
        streamAbortRef.current = null;
        activeSubmissionChatIdRef.current = null;
        setSubmissionChatId(null);
      }
    },
    [
      activeSubmissionChatIdRef,
      activeToolIds,
      baseMessages,
      canSendMessage,
      chatId,
      getVisibleModelOptions,
      isLoading,
      onThinkTagDetected,
      preserveStreamingMessage,
      refreshChats,
      registerStream,
      reloadMessages,
      selectedModel,
      setBaseMessages,
      setChatToolIds,
      setSubmissionChatId,
      streamAbortRef,
      streamingMessageIdRef,
      trackModel,
      unregisterStream,
      updateStreamContent,
    ],
  );

  const handleContinue = useCallback(
    async (messageId: string) => {
      if (!chatId) return;

      const idx = baseMessages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;

      try {
        const currentModel = selectedModelRef.current || undefined;
        const modelOptions = getVisibleModelOptions?.();
        const { response, abort } = api.continueMessage(
          messageId,
          chatId,
          currentModel,
          activeToolIds,
          modelOptions,
        );
        streamAbortRef.current = abort;

        const result = await processMessageStream(response, {
          onUpdate: (content) => updateStreamContent(chatId, content),
          onMessageId: (id) => {
            streamingMessageIdRef.current = id;
            registerStream(chatId, id);
            setBaseMessages(baseMessages.slice(0, idx));
          },
          onThinkTagDetected,
        });

        preserveStreamingMessage(result);
        unregisterStream(chatId);
        trackModel(baseMessages[idx]?.modelUsed);
      } catch (error) {
        console.error("Failed to continue message:", error);
        unregisterStream(chatId);
        await reloadMessages(chatId).catch(() => {});
      }
    },
    [
      activeToolIds,
      baseMessages,
      chatId,
      getVisibleModelOptions,
      onThinkTagDetected,
      preserveStreamingMessage,
      registerStream,
      reloadMessages,
      selectedModelRef,
      setBaseMessages,
      streamAbortRef,
      streamingMessageIdRef,
      trackModel,
      unregisterStream,
      updateStreamContent,
    ],
  );

  const handleRetry = useCallback(
    async (messageId: string) => {
      if (!chatId) return;

      const idx = baseMessages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;

      setBaseMessages(baseMessages.slice(0, idx));

      try {
        const currentModel = selectedModelRef.current || undefined;
        const modelOptions = getVisibleModelOptions?.();
        const { response, abort } = api.retryMessage(
          messageId,
          chatId,
          currentModel,
          activeToolIds,
          modelOptions,
        );
        streamAbortRef.current = abort;

        const result = await processMessageStream(response, {
          onUpdate: (content) => {
            updateStreamContent(chatId, content);
          },
          onMessageId: (id) => {
            streamingMessageIdRef.current = id;
            registerStream(chatId, id);
          },
          onThinkTagDetected,
        });

        preserveStreamingMessage(result);
        unregisterStream(chatId);
        trackModel();
      } catch (error) {
        console.error("Failed to retry message:", error);
        unregisterStream(chatId);
        await reloadMessages(chatId).catch(() => {});
      }
    },
    [
      activeToolIds,
      baseMessages,
      chatId,
      getVisibleModelOptions,
      onThinkTagDetected,
      preserveStreamingMessage,
      registerStream,
      reloadMessages,
      selectedModelRef,
      setBaseMessages,
      streamAbortRef,
      streamingMessageIdRef,
      trackModel,
      unregisterStream,
      updateStreamContent,
    ],
  );

  const handleStop = useCallback(async () => {
    const messageId = streamingMessageIdRef.current;

    streamAbortRef.current?.();
    streamAbortRef.current = null;

    if (messageId) {
      try {
        await api.cancelRun(messageId);
      } catch (error) {
        console.error("Error cancelling run:", error);
      }
    }

    const finalChatId = activeSubmissionChatIdRef.current || chatId;
    if (finalChatId) {
      unregisterStream(finalChatId);
      await reloadMessages(finalChatId).catch(() => {});
    }

    streamingMessageIdRef.current = null;
  }, [
    activeSubmissionChatIdRef,
    chatId,
    reloadMessages,
    streamAbortRef,
    streamingMessageIdRef,
    unregisterStream,
  ]);

  return {
    handleSubmit,
    handleContinue,
    handleRetry,
    handleStop,
  };
}
