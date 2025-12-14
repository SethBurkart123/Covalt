"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@/contexts/chat-context";
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

function createPlaceholderAssistant(): Message {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content: [{ type: "text", content: "" }],
    isComplete: false,
    sequence: 1,
  };
}

export function useChatInput(onThinkTagDetected?: () => void) {
  const { chatId, selectedModel, refreshChats } = useChat();

  const [messages, setMessages] = useState<Message[]>([]);
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
    setMessages(fullChat.messages || []);
  }, []);

  // Stream a response and sync state when done
  const streamWithUpdates = useCallback(
    async (
      response: Response,
      updateMessages: (content: any[]) => void,
    ) => {
      setIsLoading(true);
      abortControllerRef.current = new AbortController();
      streamingMessageIdRef.current = null;

      try {
        await processMessageStream(response, {
          onUpdate: updateMessages,
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
    },
    [chatId, onThinkTagDetected, reloadMessages],
  );

  // Can only send if last message is complete
  useEffect(() => {
    if (messages.length === 0) {
      setCanSendMessage(true);
      return;
    }
    const last = messages[messages.length - 1];
    setCanSendMessage(last.isComplete !== false);
  }, [messages]);

  // Handle chat switching - abort stream and clear input
  useEffect(() => {
    const prev = prevChatIdRef.current;
    const isSwitching = prev && chatId && prev !== chatId;

    if (isSwitching) {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
      setInput("");
    }

    prevChatIdRef.current = chatId || null;
  }, [chatId]);

  // Load messages when chat changes
  useEffect(() => {
    if (!chatId) {
      setMessages([]);
      return;
    }
    reloadMessages(chatId).catch((err) => {
      console.error("Failed to load chat messages:", err);
      setMessages([]);
    });
  }, [chatId, reloadTrigger, reloadMessages]);

  // Load siblings for all messages
  useEffect(() => {
    if (messages.length === 0) return;

    const loadSiblings = async () => {
      const map: Record<string, MessageSibling[]> = {};
      await Promise.all(
        messages.map(async (msg) => {
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
  }, [messages]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!input.trim() || isLoading || !canSendMessage) return;

      const userMessage = createUserMessage(input.trim());
      const newMessages = [...messages, userMessage];

      setMessages(newMessages);
      setInput("");
      setIsLoading(true);

      abortControllerRef.current = new AbortController();
      let assistantId: string | null = null;
      let sessionId: string | null = null;

      try {
        const response = await api.streamChat(newMessages, selectedModel, chatId || undefined);

        if (!response.ok) {
          throw new Error(`Failed to stream chat: ${response.statusText}`);
        }

        await processMessageStream(response, {
          onUpdate: (content) => {
            if (!assistantId) return;
            setMessages((prev) => [
              ...prev.filter((m) => m.id !== assistantId),
              { id: assistantId, role: "assistant", content, isComplete: false, sequence: 1 } as Message,
            ]);
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
            assistantId = id;
            streamingMessageIdRef.current = id;
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
        setMessages([...newMessages, createErrorMessage(error)]);
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
        streamingMessageIdRef.current = null;
      }
    },
    [input, isLoading, canSendMessage, messages, selectedModel, chatId, refreshChats, onThinkTagDetected, reloadMessages, trackModel],
  );

  const handleContinue = useCallback(
    async (messageId: string) => {
      if (!chatId) return;

      const message = messages.find((m) => m.id === messageId);
      try {
        const response = await api.continueMessage(messageId, chatId, selectedModel || undefined);
        await streamWithUpdates(response, (content) =>
          setMessages((prev) =>
            prev.map((m) => (m.id === messageId ? { ...m, content, isComplete: false } : m)),
          ),
        );
        trackModel(message?.modelUsed);
      } catch (error) {
        console.error("Failed to continue message:", error);
      }
    },
    [chatId, messages, selectedModel, streamWithUpdates, trackModel],
  );

  const handleRetry = useCallback(
    async (messageId: string) => {
      if (!chatId) return;

      const tempId = crypto.randomUUID();
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === messageId);
        if (idx === -1) return prev;
        return [...prev.slice(0, idx), { ...createPlaceholderAssistant(), id: tempId }];
      });

      try {
        const response = await api.retryMessage(messageId, chatId, selectedModel || undefined);
        await streamWithUpdates(response, (content) =>
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = { ...updated[updated.length - 1], content, isComplete: false };
            return updated;
          }),
        );
        trackModel();
      } catch (error) {
        console.error("Failed to retry message:", error);
      }
    },
    [chatId, selectedModel, streamWithUpdates, trackModel],
  );

  const handleEdit = useCallback(
    (messageId: string) => {
      const msg = messages.find((m) => m.id === messageId);
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
    [messages],
  );

  const handleEditCancel = useCallback(() => {
    setEditingMessageId(null);
    setEditingDraft("");
  }, []);

  const handleEditSubmit = useCallback(async () => {
    const messageId = editingMessageId;
    const newContent = editingDraft.trim();
    if (!messageId || !newContent || !chatId) return;

    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === messageId);
      if (idx === -1) return prev;
      return [
        ...prev.slice(0, idx),
        createUserMessage(newContent),
        createPlaceholderAssistant(),
      ];
    });

    setEditingMessageId(null);

    try {
      const response = await api.editUserMessage(messageId, newContent, chatId, selectedModel || undefined);
      await streamWithUpdates(response, (content) =>
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { ...updated[updated.length - 1], content, isComplete: false };
          return updated;
        }),
      );
      trackModel();
    } catch (error) {
      console.error("Failed to edit message:", error);
    }
  }, [chatId, editingDraft, editingMessageId, selectedModel, streamWithUpdates, trackModel]);

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
  }, [chatId, reloadMessages]);

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
