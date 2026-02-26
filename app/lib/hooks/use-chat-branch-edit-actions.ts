"use client";

import { useCallback, type Dispatch, type SetStateAction } from "react";
import { api } from "@/lib/services/api";
import { clearPrefetchedChat } from "@/lib/services/chat-prefetch";
import { processMessageStream } from "@/lib/services/stream-processor";
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
    "chatId" | "activeToolIds" | "registerStream" | "unregisterStream" | "updateStreamContent"
  >;
  options: UseChatInputOptions;
  refs: Pick<UseChatInputRefs, "streamingMessageIdRef" | "streamAbortRef" | "selectedModelRef">;
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
  const { chatId, activeToolIds, registerStream, unregisterStream, updateStreamContent } = context;
  const { onThinkTagDetected, getVisibleModelOptions } = options;
  const { streamingMessageIdRef, streamAbortRef, selectedModelRef } = refs;

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

    setBaseMessages([
      ...baseMessages.slice(0, idx),
      createUserMessage(
        newContent,
        editing.editingAttachments.length > 0 ? editing.editingAttachments : undefined,
      ),
    ]);
    editing.clearEditing();

    try {
      const currentModel = selectedModelRef.current || undefined;
      const modelOptions = getVisibleModelOptions?.();
      const { response, abort } = api.editUserMessage(
        messageId,
        newContent,
        chatId,
        currentModel,
        activeToolIds,
        modelOptions,
        existingAttachments,
        newAttachments.length > 0 ? newAttachments : undefined,
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
      console.error("Failed to edit message:", error);
      unregisterStream(chatId);
      await reloadMessages(chatId).catch(() => {});
    }
  }, [
    activeToolIds,
    baseMessages,
    chatId,
    editing,
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
