"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@/contexts/chat-context";
import { useTools } from "@/contexts/tools-context";
import { useStreaming } from "@/contexts/streaming-context";
import { api } from "@/lib/services/api";
import { processMessageStream } from "@/lib/services/stream-processor";
import type { ContentBlock, Message, MessageSibling } from "@/lib/types/chat";
import { addRecentModel } from "@/lib/utils";

function createUserMessage(content: string): Message {
  return {
    id: crypto.randomUUID(),
    role: "user",
    content,
    createdAt: new Date().toISOString(),
    isComplete: true,
    sequence: 1,
  };
}

function createErrorMessage(error: unknown): Message {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content: [{ type: "error", content: `Sorry, there was an error: ${error}` }],
    isComplete: false,
    sequence: 1,
  };
}

export function useChatInput(onThinkTagDetected?: () => void) {
  const { chatId, selectedModel, refreshChats } = useChat();
  const { activeToolIds } = useTools();
  const { getStreamState, registerStream, unregisterStream, updateStreamContent, onStreamComplete } = useStreaming();

  const [baseMessages, setBaseMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [reloadTrigger, setReloadTrigger] = useState(0);
  const [messageSiblings, setMessageSiblings] = useState<Record<string, MessageSibling[]>>({});
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");

  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevChatIdRef = useRef<string | null>(null);
  const selectedModelRef = useRef<string>(selectedModel);
  const activeSubmissionChatIdRef = useRef<string | null>(null);

  const streamState = chatId ? getStreamState(chatId) : undefined;
  const isLoading = streamState?.isStreaming || streamState?.isPausedForApproval || false;
  const streamingContent = streamState?.streamingContent || null;
  const streamingMessageId = streamState?.streamingMessageId || null;

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
    
    // Replace or append the streaming message
    const filtered = baseMessages.filter(m => m.id !== streamingMessageId);
    return [...filtered, streamingMessage];
  }, [baseMessages, streamingContent, streamingMessageId]);

  const canSendMessage = useMemo(() => {
    if (isLoading) return false;
    if (messages.length === 0) return true;
    const last = messages[messages.length - 1];
    return last.isComplete !== false;
  }, [isLoading, messages]);

  const triggerReload = useCallback(() => setReloadTrigger((n) => n + 1), []);

  const trackModel = useCallback(
    (model?: string) => {
      const toTrack = model || selectedModel;
      if (toTrack) addRecentModel(toTrack);
    },
    [selectedModel],
  );

  const reloadMessages = useCallback(async (id: string) => {
    const fullChat = await api.getChat(id);
    setBaseMessages(fullChat.messages || []);
  }, []);

  useEffect(() => {
    const prev = prevChatIdRef.current;
    const isSwitching = prev && chatId && prev !== chatId;

    if (isSwitching) {
      setInput("");
    }

    prevChatIdRef.current = chatId || null;
  }, [chatId]);

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

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!input.trim() || isLoading || !canSendMessage) return;

      const userMessage = createUserMessage(input.trim());
      const newBaseMessages = [...baseMessages, userMessage];

      setBaseMessages(newBaseMessages);
      setInput("");

      abortControllerRef.current = new AbortController();
      let sessionId: string | null = null;

      try {
        const response = await api.streamChat(newBaseMessages, selectedModel, chatId || undefined, activeToolIds);

        if (!response.ok) {
          throw new Error(`Failed to stream chat: ${response.statusText}`);
        }

        await processMessageStream(response, {
          onUpdate: (content) => {
            const currentSessionId = sessionId || chatId;
            if (currentSessionId) {
              updateStreamContent(currentSessionId, content);
            }
          },
          onSessionId: (id) => {
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
        abortControllerRef.current = null;
        streamingMessageIdRef.current = null;
        activeSubmissionChatIdRef.current = null;
      }
    },
    [input, isLoading, canSendMessage, baseMessages, selectedModel, chatId, refreshChats, onThinkTagDetected, reloadMessages, trackModel, activeToolIds, registerStream, unregisterStream, updateStreamContent],
  );

  const handleContinue = useCallback(
    async (messageId: string) => {
      if (!chatId) return;

      const message = baseMessages.find((m) => m.id === messageId);
      const idx = baseMessages.findIndex((m) => m.id === messageId);
      if (idx !== -1) {
        setBaseMessages(baseMessages.slice(0, idx));
      }

      try {
        const currentModel = selectedModelRef.current || undefined;
        const response = await api.continueMessage(messageId, chatId, currentModel, activeToolIds);
        
        await processMessageStream(response, {
          onUpdate: (content) => {
            updateStreamContent(chatId, content);
          },
          onMessageId: (id) => {
            streamingMessageIdRef.current = id;
            registerStream(chatId, id);
          },
          onThinkTagDetected,
        });

        unregisterStream(chatId);
        trackModel(message?.modelUsed);
      } catch (error) {
        console.error("Failed to continue message:", error);
        unregisterStream(chatId);
        await reloadMessages(chatId).catch(() => {});
      }
    },
    [chatId, baseMessages, reloadMessages, trackModel, activeToolIds, registerStream, unregisterStream, onThinkTagDetected, updateStreamContent],
  );

  const handleRetry = useCallback(
    async (messageId: string) => {
      if (!chatId) return;

      const idx = baseMessages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;
      
      const newBaseMessages = baseMessages.slice(0, idx);
      setBaseMessages(newBaseMessages);

      try {
        const currentModel = selectedModelRef.current || undefined;
        const response = await api.retryMessage(messageId, chatId, currentModel, activeToolIds);
        
        await processMessageStream(response, {
          onUpdate: (content) => {
            updateStreamContent(chatId, content);
          },
          onMessageId: (id) => {
            streamingMessageIdRef.current = id;
            registerStream(chatId, id);
          },
          onThinkTagDetected,
        });

        unregisterStream(chatId);
        trackModel();
      } catch (error) {
        console.error("Failed to retry message:", error);
        unregisterStream(chatId);
        await reloadMessages(chatId).catch(() => {});
      }
    },
    [chatId, baseMessages, reloadMessages, trackModel, activeToolIds, registerStream, unregisterStream, onThinkTagDetected, updateStreamContent],
  );

  const handleEdit = useCallback(
    (messageId: string) => {
      const msg = baseMessages.find((m) => m.id === messageId);
      if (!msg || msg.role !== "user") return;

      let initial = "";
      if (typeof msg.content === "string") {
        initial = msg.content;
      } else if (Array.isArray(msg.content)) {
        initial = msg.content
          .filter((b: ContentBlock) => b?.type === "text" && typeof b.content === "string")
          .map((b: ContentBlock) => (b as { type: "text"; content: string }).content)
          .join("\n\n");
      }

      setEditingDraft(initial);
      setEditingMessageId(messageId);
    },
    [baseMessages],
  );

  const handleEditCancel = useCallback(() => {
    setEditingMessageId(null);
    setEditingDraft("");
  }, []);

  const handleEditSubmit = useCallback(async () => {
    const messageId = editingMessageId;
    const newContent = editingDraft.trim();
    if (!messageId || !newContent || !chatId) return;

    const idx = baseMessages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;

    const userMessage = createUserMessage(newContent);
    const newBaseMessages = [...baseMessages.slice(0, idx), userMessage];
    setBaseMessages(newBaseMessages);
    setEditingMessageId(null);

    try {
      const currentModel = selectedModelRef.current || undefined;
      const response = await api.editUserMessage(messageId, newContent, chatId, currentModel, activeToolIds);
      
        await processMessageStream(response, {
          onUpdate: (content) => {
            updateStreamContent(chatId, content);
          },
          onMessageId: (id) => {
            streamingMessageIdRef.current = id;
            registerStream(chatId, id);
          },
          onThinkTagDetected,
        });

        unregisterStream(chatId);
        trackModel();
      } catch (error) {
        console.error("Failed to edit message:", error);
        unregisterStream(chatId);
        await reloadMessages(chatId).catch(() => {});
      }
  }, [chatId, editingDraft, editingMessageId, baseMessages, reloadMessages, trackModel, activeToolIds, registerStream, unregisterStream, onThinkTagDetected, updateStreamContent]);

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

    if (messageId) {
      try {
        const result = await api.cancelRun(messageId);
        if (result.cancelled && chatId) {
          await reloadMessages(chatId);
          unregisterStream(chatId);
        }
      } catch (error) {
        console.error("Error cancelling run:", error);
      }
    }

    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    streamingMessageIdRef.current = null;
  }, [chatId, reloadMessages, unregisterStream]);

  const setMessages = useCallback((messagesOrUpdater: Message[] | ((prev: Message[]) => Message[])) => {
    if (typeof messagesOrUpdater === "function") {
      setBaseMessages(messagesOrUpdater);
    } else {
      setBaseMessages(messagesOrUpdater);
    }
  }, []);

  return {
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    inputRef,
    messages,
    canSendMessage,
    triggerReload,
    setMessages,
    handleStop,
    handleContinue,
    handleRetry,
    handleEdit,
    editingMessageId,
    editingDraft,
    setEditingDraft,
    handleEditCancel,
    handleEditSubmit,
    handleNavigate,
    messageSiblings,
    streamingMessageIdRef,
  };
}
