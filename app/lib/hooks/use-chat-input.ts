"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useChat } from "@/contexts/chat-context";
import { useToolsActive } from "@/contexts/tools-context";
import { useStreaming } from "@/contexts/streaming-context";
import { isActivePhase } from "@/lib/services/chat-run-machine";
import { useChatBranchEditActions } from "@/lib/hooks/use-chat-branch-edit-actions";
import { useChatSnapshot } from "@/lib/hooks/use-chat-snapshot";
import { useChatStreamActions } from "@/lib/hooks/use-chat-stream-actions";
import type {
  UseChatInputContext,
  UseChatInputOptions,
  UseChatInputRefs,
} from "@/lib/hooks/use-chat-input.types";
import { useMessageEditing } from "@/lib/hooks/use-message-editing";
import type { StreamResult } from "@/lib/services/stream-processor";
import type { Message, MessageSibling } from "@/lib/types/chat";
import { addRecentModel } from "@/lib/utils";

export function useChatInput(
  onThinkTagDetected?: () => void,
  getVisibleModelOptions?: () => Record<string, unknown>,
  getVisibleVariables?: () => Record<string, unknown>,
) {
  const { chatId, selectedModel, refreshChats } = useChat();
  const { activeToolIds, setChatToolIds } = useToolsActive();
  const {
    getRunState,
    startRun,
    completeRun,
    onPhaseChange,
    dispatchRunEvent,
  } = useStreaming();

  const editing = useMessageEditing();

  const [baseMessages, setBaseMessages] = useState<Message[]>([]);
  const [messageSiblings, setMessageSiblings] = useState<
    Record<string, MessageSibling[]>
  >({});

  const streamAbortRef = useRef<(() => void) | null>(null);
  const selectedModelRef = useRef<string>(selectedModel);
  const loadTokenRef = useRef(0);
  const currentChatIdRef = useRef<string | null>(chatId);
  const prevChatIdRef = useRef<string | null>(null);

  const context: UseChatInputContext = {
    chatId,
    selectedModel,
    refreshChats,
    activeToolIds,
    setChatToolIds,
    getRunState,
    startRun,
    completeRun,
    onPhaseChange,
    dispatchRunEvent,
  };

  const options: UseChatInputOptions = {
    onThinkTagDetected,
    getVisibleModelOptions,
    getVisibleVariables,
  };

  const refs: UseChatInputRefs = {
    streamAbortRef,
    selectedModelRef,
    loadTokenRef,
    currentChatIdRef,
    prevChatIdRef,
  };

  const runState = chatId ? getRunState(chatId) : undefined;
  const isLoading = runState ? isActivePhase(runState.phase) : false;
  const streamingContent = runState?.content?.length
    ? runState.content
    : isLoading
      ? ([{ type: "text", content: "" }] satisfies Message["content"])
      : null;
  const streamingMessageId =
    runState?.messageId || (isLoading && chatId ? `pending-assistant-${chatId}` : null);

  const preserveStreamingMessage = useCallback(
    ({ finalContent, messageId: msgId }: StreamResult) => {
      if (finalContent.length > 0 && msgId) {
        setBaseMessages((prev) => [
          ...prev.filter((m) => m.id !== msgId),
          {
            id: msgId,
            role: "assistant",
            content: finalContent,
            isComplete: true,
            sequence: 1,
          },
        ]);
      }
    },
    [],
  );

  const messages = useMemo(() => {
    if (
      !streamingContent ||
      streamingContent.length === 0 ||
      !streamingMessageId
    ) {
      return baseMessages;
    }

    const streamingMessage: Message = {
      id: streamingMessageId,
      role: "assistant",
      content: streamingContent,
      isComplete: false,
      sequence: 1,
    };

    const filtered = baseMessages.filter((m) => m.id !== streamingMessageId);
    return [...filtered, streamingMessage];
  }, [baseMessages, streamingContent, streamingMessageId]);

  const hasErrorBlock = useCallback((message: Message): boolean => {
    if (typeof message.content === "string") return false;
    if (Array.isArray(message.content)) {
      return message.content.some((block) => block.type === "error");
    }
    return false;
  }, []);

  const canSendMessage = useMemo(() => {
    if (isLoading) return false;
    if (messages.length === 0) return true;
    const last = messages[messages.length - 1];
    if (last.isComplete !== false) return true;
    return hasErrorBlock(last);
  }, [isLoading, messages, hasErrorBlock]);

  const trackModel = useCallback(
    (model?: string) => addRecentModel(model || selectedModel),
    [selectedModel],
  );

  const {
    triggerReload,
    reloadMessages,
    loadMoreBefore,
    hasMoreBefore,
    isLoadingMoreBefore,
  } = useChatSnapshot({
    chatId,
    getRunState,
    onPhaseChange,
    refs: {
      loadTokenRef,
      currentChatIdRef,
      prevChatIdRef,
    },
    state: {
      setBaseMessages,
      setMessageSiblings,
    },
  });

  selectedModelRef.current = selectedModel;

  const { handleSubmit, handleContinue, handleRetry, handleStop } =
    useChatStreamActions({
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
    });

  const { handleEdit, handleEditSubmit, handleNavigate } =
    useChatBranchEditActions({
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
    });

  const setMessages = useCallback(
    (messagesOrUpdater: Message[] | ((prev: Message[]) => Message[])) => {
      setBaseMessages(messagesOrUpdater);
    },
    [],
  );

  return {
    handleSubmit,
    isLoading,
    messages,
    canSendMessage,
    triggerReload,
    loadMoreBefore,
    hasMoreBefore,
    isLoadingMoreBefore,
    setMessages,
    handleStop,
    handleContinue,
    handleRetry,
    handleEdit,
    editingMessageId: editing.editingMessageId,
    editingDraft: editing.editingDraft,
    setEditingDraft: editing.setEditingDraft,
    handleEditCancel: editing.clearEditing,
    handleEditSubmit,
    handleNavigate,
    messageSiblings,
    editingAttachments: editing.editingAttachments,
    addEditingAttachment: editing.addAttachment,
    removeEditingAttachment: editing.removeAttachment,
  };
}
