"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@/contexts/chat-context";
import { useToolsActive } from "@/contexts/tools-context";
import { useStreaming } from "@/contexts/streaming-context";
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
) {
  const { chatId, selectedModel, refreshChats } = useChat();
  const { activeToolIds, setChatToolIds } = useToolsActive();
  const {
    getStreamState,
    registerStream,
    unregisterStream,
    updateStreamContent,
    onStreamComplete,
  } = useStreaming();

  const editing = useMessageEditing();

  const [baseMessages, setBaseMessages] = useState<Message[]>([]);
  const [submissionChatId, setSubmissionChatId] = useState<string | null>(null);
  const [messageSiblings, setMessageSiblings] = useState<Record<string, MessageSibling[]>>({});

  const streamingMessageIdRef = useRef<string | null>(null);
  const streamAbortRef = useRef<(() => void) | null>(null);
  const selectedModelRef = useRef<string>(selectedModel);
  const activeSubmissionChatIdRef = useRef<string | null>(null);
  const loadTokenRef = useRef(0);
  const currentChatIdRef = useRef<string | null>(chatId);
  const prevChatIdRef = useRef<string | null>(null);

  const context: UseChatInputContext = {
    chatId,
    selectedModel,
    refreshChats,
    activeToolIds,
    setChatToolIds,
    getStreamState,
    registerStream,
    unregisterStream,
    updateStreamContent,
    onStreamComplete,
  };

  const options: UseChatInputOptions = {
    onThinkTagDetected,
    getVisibleModelOptions,
  };

  const refs: UseChatInputRefs = {
    streamingMessageIdRef,
    streamAbortRef,
    selectedModelRef,
    activeSubmissionChatIdRef,
    loadTokenRef,
    currentChatIdRef,
    prevChatIdRef,
  };

  const effectiveStreamChatId = submissionChatId || chatId || null;
  const streamState = effectiveStreamChatId ? getStreamState(effectiveStreamChatId) : undefined;
  const isLoading = streamState?.isStreaming || streamState?.isPausedForApproval || false;
  const streamingContent = streamState?.streamingContent || null;
  const streamingMessageId = streamState?.streamingMessageId || null;

  const preserveStreamingMessage = useCallback(({ finalContent, messageId: msgId }: StreamResult) => {
    if (finalContent.length > 0 && msgId) {
      setBaseMessages((prev) => [
        ...prev.filter((m) => m.id !== msgId),
        { id: msgId, role: "assistant", content: finalContent, isComplete: true, sequence: 1 },
      ]);
    }
  }, []);

  const messages = useMemo(() => {
    if (!streamingContent || streamingContent.length === 0 || !streamingMessageId) {
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

  const { triggerReload, reloadMessages } = useChatSnapshot({
    chatId,
    onStreamComplete,
    refs: {
      activeSubmissionChatIdRef,
      loadTokenRef,
      currentChatIdRef,
      prevChatIdRef,
    },
    state: {
      setBaseMessages,
      setMessageSiblings,
    },
  });

  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  const { handleSubmit, handleContinue, handleRetry, handleStop } = useChatStreamActions({
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
  });

  const { handleEdit, handleEditSubmit, handleNavigate } = useChatBranchEditActions({
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

  const setMessages = useCallback((messagesOrUpdater: Message[] | ((prev: Message[]) => Message[])) => {
    setBaseMessages(messagesOrUpdater);
  }, []);

  return {
    handleSubmit,
    isLoading,
    messages,
    canSendMessage,
    triggerReload,
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
    streamingMessageIdRef,
    editingAttachments: editing.editingAttachments,
    addEditingAttachment: editing.addAttachment,
    removeEditingAttachment: editing.removeAttachment,
  };
}
