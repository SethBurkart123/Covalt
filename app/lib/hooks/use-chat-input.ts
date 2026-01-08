"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@/contexts/chat-context";
import { useTools } from "@/contexts/tools-context";
import { useStreaming } from "@/contexts/streaming-context";
import { api } from "@/lib/services/api";
import { processMessageStream, type StreamResult } from "@/lib/services/stream-processor";
import type {
  Attachment,
  AttachmentType,
  ContentBlock,
  Message,
  MessageSibling,
  PendingAttachment,
} from "@/lib/types/chat";
import { linkAttachments } from "@/python/api";
import { addRecentModel } from "@/lib/utils";

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getMediaType(mimeType: string): AttachmentType {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "file";
}

function isPendingAttachment(att: Attachment | PendingAttachment): att is PendingAttachment {
  return 'data' in att && typeof att.data === 'string';
}

function createUserMessage(content: string, attachments?: (Attachment | PendingAttachment)[]): Message {
  return {
    id: crypto.randomUUID(),
    role: "user",
    content,
    createdAt: new Date().toISOString(),
    isComplete: true,
    sequence: 1,
    attachments: attachments?.map((att) => {
      if (isPendingAttachment(att)) {
        const { data, previewUrl: _previewUrl, ...rest } = att;
        return {
          ...rest,
          ...(data ? { data } : {}),
        };
      }
      return att;
    }) as Attachment[],
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
  const [reloadTrigger, setReloadTrigger] = useState(0);
  const [messageSiblings, setMessageSiblings] = useState<Record<string, MessageSibling[]>>({});
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [editingAttachments, setEditingAttachments] = useState<(Attachment | PendingAttachment)[]>([]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);
  const prevChatIdRef = useRef<string | null>(null);
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
    if (typeof message.content === "string") {
      return false;
    }
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

  const addEditingAttachment = useCallback(async (file: File) => {
    const id = crypto.randomUUID();
    const type = getMediaType(file.type);
    const data = await fileToBase64(file);
    const previewUrl = type === "image" ? URL.createObjectURL(file) : undefined;

    setEditingAttachments((prev) => [
      ...prev,
      {
        id,
        type,
        name: file.name,
        mimeType: file.type,
        size: file.size,
        data,
        previewUrl,
      },
    ]);
  }, []);

  const removeEditingAttachment = useCallback((id: string) => {
    setEditingAttachments((prev) => {
      const att = prev.find((a) => a.id === id);
      if (att && isPendingAttachment(att) && att.previewUrl) {
        URL.revokeObjectURL(att.previewUrl);
      }
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const handleSubmit = useCallback(
    async (inputText: string, attachments: Attachment[]) => {
      const hasContent = inputText.trim() || attachments.length > 0;
      if (!hasContent || isLoading || !canSendMessage) return;

      const userMessage = createUserMessage(inputText.trim(), attachments);
      const newBaseMessages = [...baseMessages, userMessage];

      setBaseMessages(newBaseMessages);

      abortControllerRef.current = new AbortController();
      let sessionId: string | null = null;
      let attachmentsLinked = false;

      try {
        const response = await api.streamChat(
          newBaseMessages,
          selectedModel,
          chatId || undefined,
          activeToolIds,
          attachments.length > 0 ? attachments : undefined
        );

        if (!response.ok) {
          throw new Error(`Failed to stream chat: ${response.statusText}`);
        }

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
            if (id && attachments.length > 0 && !attachmentsLinked) {
              attachmentsLinked = true;
              try {
                await linkAttachments({
                  body: {
                    chatId: id,
                    attachments: attachments.map(a => ({
                      id: a.id,
                      mimeType: a.mimeType,
                    })),
                  },
                });
              } catch (e) {
                console.error("Failed to link attachments:", e);
              }
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
          // Preserve streaming content before unregistering to prevent message disappearing
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
        abortControllerRef.current = null;
        streamingMessageIdRef.current = null;
        activeSubmissionChatIdRef.current = null;
      }
    },
    [isLoading, canSendMessage, baseMessages, selectedModel, chatId, refreshChats, onThinkTagDetected, reloadMessages, trackModel, activeToolIds, registerStream, unregisterStream, updateStreamContent, preserveStreamingMessage],
  );

  const handleContinue = useCallback(
    async (messageId: string) => {
      if (!chatId) return;

      const idx = baseMessages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;
      
      const message = baseMessages[idx];

      try {
        const currentModel = selectedModelRef.current || undefined;
        const response = await api.continueMessage(messageId, chatId, currentModel, activeToolIds);
        
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
        trackModel(message?.modelUsed);
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
      
      const newBaseMessages = baseMessages.slice(0, idx);
      setBaseMessages(newBaseMessages);

      try {
        const currentModel = selectedModelRef.current || undefined;
        const response = await api.retryMessage(messageId, chatId, currentModel, activeToolIds);
        
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

        // Preserve streaming content before unregistering to prevent message disappearing
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
      setEditingAttachments(msg.attachments || []);
    },
    [baseMessages],
  );

  const handleEditCancel = useCallback(() => {
    setEditingMessageId(null);
    setEditingDraft("");
    setEditingAttachments([]);
  }, []);

  const handleEditSubmit = useCallback(async () => {
    const messageId = editingMessageId;
    const newContent = editingDraft.trim();
    if (!messageId || (!newContent && editingAttachments.length === 0) || !chatId) return;

    const idx = baseMessages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;

    const existingAttachments: Attachment[] = [];
    const newAttachments: PendingAttachment[] = [];
    
    editingAttachments.forEach((att) => {
      if (isPendingAttachment(att)) {
        newAttachments.push(att);
      } else {
        existingAttachments.push(att);
      }
    });

    const userMessage = createUserMessage(newContent, editingAttachments.length > 0 ? editingAttachments : undefined);
    const newBaseMessages = [...baseMessages.slice(0, idx), userMessage];
    setBaseMessages(newBaseMessages);
    setEditingMessageId(null);
    setEditingAttachments([]);

    try {
      const currentModel = selectedModelRef.current || undefined;
      const response = await api.editUserMessage(
        messageId,
        newContent,
        chatId,
        currentModel,
        activeToolIds,
        existingAttachments,
        newAttachments.length > 0 ? newAttachments : undefined
      );
      
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

      // Preserve streaming content before unregistering to prevent message disappearing
      preserveStreamingMessage(result);
      unregisterStream(chatId);
      trackModel();
    } catch (error) {
      console.error("Failed to edit message:", error);
      unregisterStream(chatId);
      await reloadMessages(chatId).catch(() => {});
    }
  }, [chatId, editingDraft, editingMessageId, editingAttachments, baseMessages, reloadMessages, trackModel, activeToolIds, registerStream, unregisterStream, onThinkTagDetected, updateStreamContent, preserveStreamingMessage]);

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
    editingMessageId,
    editingDraft,
    setEditingDraft,
    handleEditCancel,
    handleEditSubmit,
    handleNavigate,
    messageSiblings,
    streamingMessageIdRef,
    editingAttachments,
    addEditingAttachment,
    removeEditingAttachment,
  };
}
