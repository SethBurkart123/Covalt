"use client";

import { useCallback, type Dispatch, type SetStateAction } from "react";
import { api } from "@/lib/services/api";
import {
  clearPrefetchedChat,
  getPrefetchedChat,
  setPrefetchedChat,
} from "@/lib/services/chat-prefetch";
import { processMessageStream } from "@/lib/services/stream-processor";
import { getOutputSmoothingConfig } from "@/lib/services/output-smoothing-settings";
import { runtimeEventToRunEvent } from "@/lib/services/chat-run-machine";
import {
  createUserMessage,
  isPendingAttachment,
} from "@/lib/utils/message";
import type {
  Attachment,
  Message,
  PendingAttachment,
} from "@/lib/types/chat";
import type {
  PreserveStreamingMessage,
  ReloadMessages,
  TrackModel,
  TriggerReload,
  UseChatInputContext,
  UseChatInputEditing,
  UseChatInputOptions,
  UseChatInputRefs,
} from "@/lib/hooks/use-chat-input.types";

interface UseChatBranchEditActionsParams {
  context: Pick<
    UseChatInputContext,
    "chatId" | "activeToolIds" | "startRun" | "completeRun" | "dispatchRunEvent"
  >;
  options: UseChatInputOptions;
  refs: Pick<UseChatInputRefs, "streamAbortRef" | "selectedModelRef" | "currentChatIdRef">;
  editing: UseChatInputEditing;
  baseMessages: Message[];
  setBaseMessages: Dispatch<SetStateAction<Message[]>>;
  preserveStreamingMessage: PreserveStreamingMessage;
  reloadMessages: ReloadMessages;
  trackModel: TrackModel;
  triggerReload: TriggerReload;
}

export function useChatBranchEditActions({
  context,
  options,
  refs,
  editing,
  baseMessages,
  setBaseMessages,
  preserveStreamingMessage,
  reloadMessages,
  trackModel,
  triggerReload,
}: UseChatBranchEditActionsParams) {
  const { chatId, activeToolIds, startRun, completeRun, dispatchRunEvent } = context;
  const { onThinkTagDetected, getVisibleModelOptions, getVisibleVariables } = options;
  const { streamAbortRef, selectedModelRef, currentChatIdRef } = refs;

  const isStillForeground = useCallback(
    (targetChatId: string) => currentChatIdRef.current === targetChatId,
    [currentChatIdRef],
  );

  const handleEdit = useCallback(
    (messageId: string) => {
      const msg = baseMessages.find((m) => m.id === messageId);
      if (msg) editing.startEditing(msg);
    },
    [baseMessages, editing],
  );

  const handleEditSubmit = useCallback(async () => {
    const messageId = editing.editingMessageId;
    const newContent = editing.editingDraft.trim();
    if (!messageId || (!newContent && editing.editingAttachments.length === 0) || !chatId) return;

    const idx = baseMessages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;

    const existingAttachments: Attachment[] = [];
    const newAttachments: PendingAttachment[] = [];

    editing.editingAttachments.forEach((att) => {
      if (isPendingAttachment(att)) {
        newAttachments.push(att);
      } else {
        existingAttachments.push(att);
      }
    });

    const nextBaseMessages: Message[] = [
      ...baseMessages.slice(0, idx),
      createUserMessage(
        newContent,
        editing.editingAttachments.length > 0 ? editing.editingAttachments : undefined,
      ),
    ];
    setBaseMessages(nextBaseMessages);
    editing.clearEditing();

    const outputSmoothing = await getOutputSmoothingConfig();
    startRun(chatId, { subscribe: !outputSmoothing.enabled });
    const existing = getPrefetchedChat(chatId);
    if (!existing?.siblings) {
      setPrefetchedChat(chatId, {
        ...(existing ?? {}),
        messages: nextBaseMessages,
        fetchedAt: Date.now(),
      });
    }

    try {
      const currentModel = selectedModelRef.current || undefined;
      const modelOptions = getVisibleModelOptions?.();
      const variables = getVisibleVariables?.();
      const { response, abort } = api.editUserMessage(
        messageId,
        newContent,
        chatId,
        currentModel,
        activeToolIds,
        modelOptions,
        existingAttachments,
        newAttachments.length > 0 ? newAttachments : undefined,
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
      console.error("Failed to edit message:", error);
      dispatchRunEvent(chatId, { type: "ERROR", message: String(error) });
      completeRun(chatId);
      if (isStillForeground(chatId)) {
        await reloadMessages(chatId).catch(() => {});
      }
    }
  }, [
    activeToolIds,
    baseMessages,
    chatId,
    completeRun,
    dispatchRunEvent,
    editing,
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
  ]);

  const handleNavigate = useCallback(
    async (messageId: string, siblingId: string) => {
      if (!chatId) return;
      try {
        await api.switchToSibling(messageId, siblingId, chatId);
        clearPrefetchedChat(chatId);
        triggerReload();
      } catch (error) {
        console.error("Failed to switch sibling:", error);
      }
    },
    [chatId, triggerReload],
  );

  return {
    handleEdit,
    handleEditSubmit,
    handleNavigate,
  };
}
