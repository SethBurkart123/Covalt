"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@/contexts/chat-context";
import { useTools } from "@/contexts/tools-context";
import { useStreaming } from "@/contexts/streaming-context";
import { api } from "@/lib/services/api";
import { processMessageStream, type StreamResult } from "@/lib/services/stream-processor";
import { useMessageEditing } from "@/lib/hooks/use-message-editing";
import {
  createUserMessage,
  createErrorMessage,
  isPendingAttachment,
} from "@/lib/utils/message";
import type {
  Attachment,
  Message,
  MessageSibling,
  PendingAttachment,
} from "@/lib/types/chat";
import { addRecentModel } from "@/lib/utils";

export function useChatInput(onThinkTagDetected?: () => void) {
  const { chatId, selectedModel, refreshChats } = useChat();
  const { activeToolIds, setChatToolIds } = useTools();
  const { getStreamState, registerStream, unregisterStream, updateStreamContent, onStreamComplete } = useStreaming();

  const editing = useMessageEditing();

  const [baseMessages, setBaseMessages] = useState<Message[]>([]);
  const [reloadTrigger, setReloadTrigger] = useState(0);
  const [messageSiblings, setMessageSiblings] = useState<Record<string, MessageSibling[]>>({});

  const streamingMessageIdRef = useRef<string | null>(null);
  const streamAbortRef = useRef<(() => void) | null>(null);
  const selectedModelRef = useRef<string>(selectedModel);
  const activeSubmissionChatIdRef = useRef<string | null>(null);

  const streamState = chatId ? getStreamState(chatId) : undefined;
  const isLoading = streamState?.isStreaming || streamState?.isPausedForApproval || false;
  const streamingContent = streamState?.streamingContent || null;
  const streamingMessageId = streamState?.streamingMessageId || null;

  const preserveStreamingMessage = useCallback(({ finalContent, messageId: msgId }: StreamResult) => {
    if (finalContent.length > 0 && msgId) {
      setBaseMessages((prev) => [
        ...prev.filter(m => m.id !== msgId),
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
    
    const filtered = baseMessages.filter(m => m.id !== streamingMessageId);
    return [...filtered, streamingMessage];
  }, [baseMessages, streamingContent, streamingMessageId]);

  const hasErrorBlock = useCallback((message: Message): boolean => {
    if (typeof message.content === "string") return false;
    if (Array.isArray(message.content)) return message.content.some((block) => block.type === "error");
    return false;
  }, []);

  const canSendMessage = useMemo(() => {
    if (isLoading) return false;
    if (messages.length === 0) return true;
    const last = messages[messages.length - 1];
    if (last.isComplete !== false) return true;
    return hasErrorBlock(last);
  }, [isLoading, messages, hasErrorBlock]);

  const triggerReload = useCallback(() => setReloadTrigger((n) => n + 1), []);

  const trackModel = useCallback(
    (model?: string) => addRecentModel(model || selectedModel),
    [selectedModel],
  );

  const reloadMessages = useCallback(async (id: string) => {
    const fullChat = await api.getChat(id);
    setBaseMessages(fullChat.messages || []);
  }, []);

  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  useEffect(() => {
    if (activeSubmissionChatIdRef.current) return;
    
    if (!chatId) {
      setBaseMessages([]);
      return;
    }
    
    const existingStream = getStreamState(chatId);
    if (existingStream?.isStreaming) {
      return;
    }
    
    reloadMessages(chatId).catch((err) => {
      console.error("Failed to load chat messages:", err);
      setBaseMessages([]);
    });
  }, [chatId, reloadTrigger, reloadMessages, getStreamState]);

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

  useEffect(() => {
    if (baseMessages.length === 0) return;

    const loadSiblings = async () => {
      const map: Record<string, MessageSibling[]> = {};
      await Promise.all(
        baseMessages.map(async (msg) => {
          try {
            map[msg.id] = await api.getMessageSiblings(msg.id);
          } catch {
            map[msg.id] = [];
          }
        }),
      );
      setMessageSiblings(map);
    };

    loadSiblings();
  }, [baseMessages]);

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

      try {
        const { response, abort } = api.streamChat(
          newBaseMessages,
          selectedModel,
          chatId || undefined,
          mergedToolIds,
          attachments.length > 0 ? attachments : undefined
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
            if (id) activeSubmissionChatIdRef.current = id;
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
      }
    },
    [isLoading, canSendMessage, baseMessages, selectedModel, chatId, refreshChats, onThinkTagDetected, reloadMessages, trackModel, activeToolIds, setChatToolIds, registerStream, unregisterStream, updateStreamContent, preserveStreamingMessage],
  );

  const handleContinue = useCallback(
    async (messageId: string) => {
      if (!chatId) return;

      const idx = baseMessages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;

      try {
        const currentModel = selectedModelRef.current || undefined;
        const { response, abort } = api.continueMessage(messageId, chatId, currentModel, activeToolIds);
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
    [chatId, baseMessages, reloadMessages, trackModel, activeToolIds, registerStream, unregisterStream, onThinkTagDetected, updateStreamContent, preserveStreamingMessage],
  );

  const handleRetry = useCallback(
    async (messageId: string) => {
      if (!chatId) return;

      const idx = baseMessages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;

      setBaseMessages(baseMessages.slice(0, idx));

      try {
        const currentModel = selectedModelRef.current || undefined;
        const { response, abort } = api.retryMessage(messageId, chatId, currentModel, activeToolIds);
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
    [chatId, baseMessages, reloadMessages, trackModel, activeToolIds, registerStream, unregisterStream, onThinkTagDetected, updateStreamContent, preserveStreamingMessage],
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

    setBaseMessages([
      ...baseMessages.slice(0, idx),
      createUserMessage(newContent, editing.editingAttachments.length > 0 ? editing.editingAttachments : undefined),
    ]);
    editing.clearEditing();

    try {
      const currentModel = selectedModelRef.current || undefined;
      const { response, abort } = api.editUserMessage(
        messageId,
        newContent,
        chatId,
        currentModel,
        activeToolIds,
        existingAttachments,
        newAttachments.length > 0 ? newAttachments : undefined
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
  }, [chatId, editing, baseMessages, reloadMessages, trackModel, activeToolIds, registerStream, unregisterStream, onThinkTagDetected, updateStreamContent, preserveStreamingMessage]);

  const handleNavigate = useCallback(
    async (messageId: string, siblingId: string) => {
      if (!chatId) return;
      try {
        await api.switchToSibling(messageId, siblingId, chatId);
        triggerReload();
      } catch (error) {
        console.error("Failed to switch sibling:", error);
      }
    },
    [chatId, triggerReload],
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
  }, [chatId, reloadMessages, unregisterStream]);

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
