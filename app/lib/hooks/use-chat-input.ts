"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@/contexts/chat-context";
import { useTools } from "@/contexts/tools-context";
import { api } from "@/lib/services/api";
import { processMessageStream } from "@/lib/services/stream-processor";
import type { Message, MessageSibling } from "@/lib/types/chat";
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

  const [baseMessages, setBaseMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState<any[] | null>(null);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [canSendMessage, setCanSendMessage] = useState(true);
  const [reloadTrigger, setReloadTrigger] = useState(0);
  const [messageSiblings, setMessageSiblings] = useState<Record<string, MessageSibling[]>>({});
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");

  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevChatIdRef = useRef<string | null>(null);
  const selectedModelRef = useRef<string>(selectedModel);
  
  const messages = useMemo(() => {
    if (streamingContent === null || streamingMessageId === null) {
      return baseMessages;
    }
    const streamingMessage: Message = {
      id: streamingMessageId,
      role: "assistant",
      content: streamingContent,
      isComplete: false,
      sequence: 1,
    };
    return [...baseMessages, streamingMessage];
  }, [baseMessages, streamingContent, streamingMessageId]);

  const clearStreaming = useCallback(() => {
    setStreamingContent(null);
    setStreamingMessageId(null);
  }, []);

  const startStreaming = useCallback((messageId: string) => {
    setStreamingMessageId(messageId);
    setStreamingContent([{ type: "text", content: "" }]);
  }, []);

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
    clearStreaming();
    setBaseMessages(fullChat.messages || []);
  }, [clearStreaming]);

  const streamWithUpdates = useCallback(
    async (
      response: Response,
      messageId: string,
      isUpdateExisting: boolean = false,
    ) => {
      setIsLoading(true);
      abortControllerRef.current = new AbortController();
      streamingMessageIdRef.current = null;

      if (isUpdateExisting) {
        try {
          await processMessageStream(response, {
            onUpdate: (content) => {
              setBaseMessages((prev) =>
                prev.map((m) => (m.id === messageId ? { ...m, content, isComplete: false } : m)),
              );
            },
            onMessageId: (id) => {
              streamingMessageIdRef.current = id;
            },
            onThinkTagDetected,
          });

          if (chatId) await reloadMessages(chatId);
        } finally {
          setIsLoading(false);
          abortControllerRef.current = null;
          streamingMessageIdRef.current = null;
        }
        return;
      }

      startStreaming(messageId);

      try {
        await processMessageStream(response, {
          onUpdate: (content) => {
            setStreamingContent(content);
          },
          onMessageId: (id) => {
            streamingMessageIdRef.current = id;
            setStreamingMessageId(id);
          },
          onThinkTagDetected,
        });

        if (chatId) await reloadMessages(chatId);
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
        streamingMessageIdRef.current = null;
        clearStreaming();
      }
    },
    [chatId, onThinkTagDetected, reloadMessages, clearStreaming, startStreaming],
  );

  useEffect(() => {
    if (messages.length === 0) {
      setCanSendMessage(true);
      return;
    }
    const last = messages[messages.length - 1];
    setCanSendMessage(last.isComplete !== false);
  }, [messages]);

  useEffect(() => {
    const prev = prevChatIdRef.current;
    const isSwitching = prev && chatId && prev !== chatId;

    if (isSwitching) {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
      setInput("");
      clearStreaming();
    }

    prevChatIdRef.current = chatId || null;
  }, [chatId, clearStreaming]);

  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  useEffect(() => {
    if (!chatId) {
      setBaseMessages([]);
      clearStreaming();
      return;
    }
    reloadMessages(chatId).catch((err) => {
      console.error("Failed to load chat messages:", err);
      setBaseMessages([]);
      clearStreaming();
    });
  }, [chatId, reloadTrigger, reloadMessages, clearStreaming]);

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
      setIsLoading(true);

      abortControllerRef.current = new AbortController();
      let sessionId: string | null = null;

      const tempId = crypto.randomUUID();
      startStreaming(tempId);

      try {
        const response = await api.streamChat(newBaseMessages, selectedModel, chatId || undefined, activeToolIds);

        if (!response.ok) {
          throw new Error(`Failed to stream chat: ${response.statusText}`);
        }

        await processMessageStream(response, {
          onUpdate: (content) => {
            setStreamingContent(content);
          },
          onSessionId: (id) => {
            sessionId = id;
            if (!chatId && id) {
              window.history.replaceState(null, "", `/?chatId=${id}`);
              refreshChats();
              api.generateChatTitle(id).then(refreshChats).catch(console.error);
            }
          },
          onMessageId: (id) => {
            streamingMessageIdRef.current = id;
            setStreamingMessageId(id);
          },
          onThinkTagDetected,
        });

        const finalChatId = sessionId || chatId;
        if (finalChatId) {
          await reloadMessages(finalChatId);
          trackModel();
        }
      } catch (error) {
        console.error("Error streaming chat:", error);
        clearStreaming();
        setBaseMessages([...newBaseMessages, createErrorMessage(error)]);
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
        streamingMessageIdRef.current = null;
        clearStreaming();
      }
    },
    [input, isLoading, canSendMessage, baseMessages, selectedModel, chatId, refreshChats, onThinkTagDetected, reloadMessages, trackModel, clearStreaming, startStreaming, activeToolIds],
  );

  const handleContinue = useCallback(
    async (messageId: string) => {
      if (!chatId) return;

      const message = baseMessages.find((m) => m.id === messageId);
      try {
        const currentModel = selectedModelRef.current || undefined;
        const response = await api.continueMessage(messageId, chatId, currentModel, activeToolIds);
        await streamWithUpdates(response, messageId, true);
        trackModel(message?.modelUsed);
      } catch (error) {
        console.error("Failed to continue message:", error);
      }
    },
    [chatId, baseMessages, streamWithUpdates, trackModel, activeToolIds],
  );

  const handleRetry = useCallback(
    async (messageId: string) => {
      if (!chatId) return;

      const idx = baseMessages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;
      
      const newBaseMessages = baseMessages.slice(0, idx);
      setBaseMessages(newBaseMessages);

    const tempId = crypto.randomUUID();
    startStreaming(tempId);
    setIsLoading(true);

    try {
      const currentModel = selectedModelRef.current || undefined;
      const response = await api.retryMessage(messageId, chatId, currentModel, activeToolIds);
        
        await processMessageStream(response, {
          onUpdate: (content) => {
            setStreamingContent(content);
          },
          onMessageId: (id) => {
            streamingMessageIdRef.current = id;
            setStreamingMessageId(id);
          },
          onThinkTagDetected,
        });

        if (chatId) await reloadMessages(chatId);
        trackModel();
      } catch (error) {
        console.error("Failed to retry message:", error);
        clearStreaming();
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
        streamingMessageIdRef.current = null;
        clearStreaming();
      }
    },
    [chatId, baseMessages, reloadMessages, trackModel, clearStreaming, startStreaming, onThinkTagDetected, activeToolIds],
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
          .filter((b: any) => b?.type === "text" && typeof b.content === "string")
          .map((b: any) => b.content)
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

    const tempId = crypto.randomUUID();
    startStreaming(tempId);
    setIsLoading(true);

    try {
      const currentModel = selectedModelRef.current || undefined;
      const response = await api.editUserMessage(messageId, newContent, chatId, currentModel, activeToolIds);
      
      await processMessageStream(response, {
        onUpdate: (content) => {
          setStreamingContent(content);
        },
        onMessageId: (id) => {
          streamingMessageIdRef.current = id;
          setStreamingMessageId(id);
        },
        onThinkTagDetected,
      });

      if (chatId) await reloadMessages(chatId);
      trackModel();
    } catch (error) {
      console.error("Failed to edit message:", error);
      clearStreaming();
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
      streamingMessageIdRef.current = null;
      clearStreaming();
    }
  }, [chatId, editingDraft, editingMessageId, baseMessages, reloadMessages, trackModel, clearStreaming, startStreaming, onThinkTagDetected]);

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
        }
      } catch (error) {
        console.error("Error cancelling run:", error);
      }
    }

    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    streamingMessageIdRef.current = null;
    setIsLoading(false);
    clearStreaming();
  }, [chatId, reloadMessages, clearStreaming]);

  const setMessages = useCallback((messagesOrUpdater: Message[] | ((prev: Message[]) => Message[])) => {
    if (typeof messagesOrUpdater === "function") {
      setBaseMessages(messagesOrUpdater);
    } else {
      setBaseMessages(messagesOrUpdater);
    }
    clearStreaming();
  }, [clearStreaming]);

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
