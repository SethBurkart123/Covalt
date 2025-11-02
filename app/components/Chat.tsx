"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@/contexts/chat-context";
import ChatMessageList from "./ChatMessageList";
import { api } from "@/lib/services/api";
import type { Message, MessageSibling } from "@/lib/types/chat";
import { addRecentModel } from "@/lib/utils";

// Stream processor - handles SSE parsing and content block building
async function processMessageStream(
  response: Response,
  onUpdate: (content: any[]) => void,
  onSessionId?: (sessionId: string) => void,
  onMessageId?: (messageId: string) => void
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  const contentBlocks: any[] = [];
  let currentTextBlock = "";
  let currentReasoningBlock = "";

  const flushTextBlock = () => {
    if (currentTextBlock) {
      contentBlocks.push({ type: "text", content: currentTextBlock });
      currentTextBlock = "";
    }
  };

  const flushReasoningBlock = () => {
    if (currentReasoningBlock) {
      contentBlocks.push({
        type: "reasoning",
        content: currentReasoningBlock,
        isCompleted: true
      });
      currentReasoningBlock = "";
    }
  };

  const scheduleUpdate = () => {
    requestAnimationFrame(() => {
      const content = [...contentBlocks];
      const hasText = currentTextBlock && currentTextBlock.length > 0;
      const hasReason = currentReasoningBlock && currentReasoningBlock.length > 0;
      if (hasText) {
        content.push({ type: "text", content: currentTextBlock });
      }
      if (hasReason) {
        content.push({ type: "reasoning", content: currentReasoningBlock, isCompleted: false });
      }
      if (content.length === 0) {
        content.push({ type: "text", content: "" });
      }
      onUpdate(content);
    });
  };

  let buffer = "";
  let currentEvent = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;

        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);

            if (currentEvent === "RunStarted" && parsed.sessionId && onSessionId) {
              onSessionId(parsed.sessionId);
              scheduleUpdate();
            }
            else if (currentEvent === "AssistantMessageId" && parsed.content && onMessageId) {
              onMessageId(parsed.content);
            }
            else if (currentEvent === "RunContent" && parsed.content) {
              if (currentReasoningBlock && !currentTextBlock) {
                flushReasoningBlock();
              }
              if (
                currentTextBlock === "" &&
                contentBlocks.length > 0 &&
                contentBlocks[contentBlocks.length - 1]?.type === "text"
              ) {
                const last = contentBlocks.pop();
                if (last && typeof last.content === 'string') {
                  currentTextBlock = last.content;
                }
              }
              currentTextBlock += parsed.content;
              scheduleUpdate();
            }
            else if (currentEvent === "SeedBlocks" && Array.isArray(parsed.blocks)) {
              // Seed with existing blocks from backend (continuation)
              contentBlocks.splice(0, contentBlocks.length, ...parsed.blocks);
              currentTextBlock = "";
              currentReasoningBlock = "";
              scheduleUpdate();
            }
            else if (currentEvent === "ReasoningStarted") {
              flushTextBlock();
              scheduleUpdate();
            }
            else if (currentEvent === "ReasoningStep" && parsed.reasoningContent) {
              if (currentTextBlock && !currentReasoningBlock) {
                flushTextBlock();
              }
              currentReasoningBlock += parsed.reasoningContent;
              scheduleUpdate();
            }
            else if (currentEvent === "ReasoningCompleted") {
              flushReasoningBlock();
              scheduleUpdate();
            }
            else if (currentEvent === "ToolCallStarted") {
              flushTextBlock();
              flushReasoningBlock();
              if (parsed.tool) {
                contentBlocks.push({
                  type: "tool_call",
                  id: parsed.tool.id,
                  toolName: parsed.tool.toolName,
                  toolArgs: parsed.tool.toolArgs,
                  isCompleted: false
                });
                scheduleUpdate();
              }
            }
            else if (currentEvent === "ToolCallCompleted" && parsed.tool) {
              const toolBlock = [...contentBlocks].reverse().find(
                (b: any) => b.type === "tool_call" && b.id === parsed.tool.id
              );
              if (toolBlock) {
                toolBlock.toolResult = parsed.tool.toolResult;
                toolBlock.isCompleted = true;
              }
              scheduleUpdate();
            }
            else if (currentEvent === "RunCompleted" || currentEvent === "RunError") {
              flushTextBlock();
              flushReasoningBlock();
              if (currentEvent === "RunError") {
                const errText = typeof parsed.error === 'string' ? parsed.error
                  : (typeof parsed.content === 'string' ? parsed.content : 'An error occurred.');
                contentBlocks.push({ type: "error", content: errText });
              }
              scheduleUpdate();
            }
          } catch (err) {
            console.error("Failed to parse SSE data:", err);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

interface ChatProps {
  messages: Message[];
  isLoading: boolean;
  messageSiblings: Record<string, MessageSibling[]>;
  onContinue: (messageId: string) => void;
  onRetry: (messageId: string) => void;
  onEditStart: (messageId: string) => void;
  editingMessageId: string | null;
  editingDraft: string;
  setEditingDraft: (val: string) => void;
  onEditCancel: () => void;
  onEditSubmit: () => void;
  onNavigate: (messageId: string, siblingId: string) => void;
}

export default function Chat({ 
  messages, 
  isLoading, 
  messageSiblings,
  onContinue,
  onRetry,
  onEditStart,
  editingMessageId,
  editingDraft,
  setEditingDraft,
  onEditCancel,
  onEditSubmit,
  onNavigate,
}: ChatProps) {

  return (
    <div className="flex-1 px-4 py-6 max-w-[50rem] w-full mx-auto">
      <ChatMessageList 
        messages={messages}
        isLoading={isLoading}
        messageSiblings={messageSiblings}
        onContinue={onContinue}
        onRetry={onRetry}
        onEditStart={onEditStart}
        editingMessageId={editingMessageId}
        editingDraft={editingDraft}
        setEditingDraft={setEditingDraft}
        onEditCancel={onEditCancel}
        onEditSubmit={onEditSubmit}
        onNavigate={onNavigate}
        actionLoading={null}
      />
    </div>
  );
}

export function useChatInput() {
  const {
    chatId,
    selectedModel,
    refreshChats,
  } = useChat();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [canSendMessage, setCanSendMessage] = useState(true);
  const [reloadTrigger, setReloadTrigger] = useState(0);
  const [messageSiblings, setMessageSiblings] = useState<Record<string, MessageSibling[]>>({});
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<string>("");
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevChatIdRef = useRef<string | null>(null);

  // Helper: stream a response and handle all the state updates
  const streamAction = async (
    response: Response,
    onStreamUpdate: (content: any[]) => void,
    onBackendMessageId?: (id: string) => void
  ) => {
    setIsLoading(true);
    abortControllerRef.current = new AbortController();
    streamingMessageIdRef.current = null;
    let streamingDone = false;

    try {
      await processMessageStream(
        response,
        (content) => {
          if (streamingDone) return;
          onStreamUpdate(content);
        },
        undefined,
        (messageId) => {
          streamingMessageIdRef.current = messageId;
          onBackendMessageId?.(messageId);
        }
      );

      streamingDone = true;
      if (chatId) {
        const fullChat = await api.getChat(chatId);
        setMessages(fullChat.messages || []);
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
      streamingMessageIdRef.current = null;
    }
  };

  // Check if we can send messages (last message must be complete)
  useEffect(() => {
    if (messages.length === 0) {
      setCanSendMessage(true);
      return;
    }
    
    const lastMessage = messages[messages.length - 1];
    setCanSendMessage(lastMessage.isComplete !== false);
  }, [messages]);

  // Abort stream and clear input when switching between different existing chats
  useEffect(() => {
    const prevChatId = prevChatIdRef.current;
    
    // Only abort if we're switching between different existing chats
    // Don't abort when transitioning from empty to a new chat (initialization)
    const isSwitchingChats = prevChatId && chatId && prevChatId !== chatId;
    
    if (isSwitchingChats && abortControllerRef.current) {
      try { abortControllerRef.current.abort(); } catch {}
      abortControllerRef.current = null;
      setIsLoading(false);
    }
    
    if (isSwitchingChats) {
      setInput("");
    }
    
    // Update ref for next comparison
    prevChatIdRef.current = chatId || null;
  }, [chatId]);

  // Load messages when chatId changes or reload is triggered
  useEffect(() => {
    const loadChatMessages = async () => {
      if (!chatId) {
        setMessages([]);
        return;
      }
      
      try {
        const fullChat = await api.getChat(chatId);
        setMessages(fullChat.messages || []);
      } catch (error) {
        console.error('Failed to load chat messages:', error);
        setMessages([]);
      }
    };
    
    loadChatMessages();
  }, [chatId, reloadTrigger]);

  // Load sibling information for all messages
  useEffect(() => {
    const loadSiblings = async () => {
      const siblingsMap: Record<string, MessageSibling[]> = {};
      
      for (const msg of messages) {
        try {
          const siblings = await api.getMessageSiblings(msg.id);
          siblingsMap[msg.id] = siblings;
        } catch (error) {
          console.error(`Failed to load siblings for message ${msg.id}:`, error);
          siblingsMap[msg.id] = [];
        }
      }
      
      setMessageSiblings(siblingsMap);
    };

    if (messages.length > 0) {
      loadSiblings();
    }
  }, [messages]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!input.trim() || isLoading || !canSendMessage) return;

    const currentChatId = chatId;
    const userMessageContent = input.trim();

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: userMessageContent,
      createdAt: new Date().toISOString(),
      isComplete: true,
      sequence: 1,
    };

    // Optimistically show user message
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    abortControllerRef.current = new AbortController();
    let assistantMessageId: string | null = null;
    let sessionId: string | null = null;
    let streamingDone = false;

    try {
      const response = await api.streamChat(
        newMessages,
        selectedModel,
        currentChatId || undefined
      );

      if (!response.ok) {
        throw new Error(`Failed to stream chat: ${response.statusText}`);
      }

      // Stream with live updates
      await processMessageStream(
        response,
        (content) => {
          if (streamingDone || !assistantMessageId) return;
          setMessages(prev => {
            const withoutLast = prev.filter(m => m.id !== assistantMessageId);
            return [
              ...withoutLast,
              {
                id: assistantMessageId,
                role: "assistant",
                content,
                isComplete: false,
                sequence: 1,
              } as Message,
            ];
          });
        },
        (newSessionId) => {
          sessionId = newSessionId;
          // Update URL and refresh sidebar for new chats
          if (!currentChatId && newSessionId) {
            window.history.replaceState(null, '', `/?chatId=${newSessionId}`);
            refreshChats();
            
            // Trigger title generation for new chat
            api.generateChatTitle(newSessionId).then(() => {
              refreshChats();
            }).catch((err) => {
              console.error("Failed to generate title:", err);
            });
          }
        },
        (messageId) => {
          // Capture assistant message ID from backend
          assistantMessageId = messageId;
          streamingMessageIdRef.current = messageId;
        }
      );

      // Reload authoritative state from backend
      const finalChatId = sessionId || currentChatId;
      if (finalChatId) {
        streamingDone = true;
        const fullChat = await api.getChat(finalChatId);
        setMessages(fullChat.messages || []);
        
        // Track model usage for recent models
        if (selectedModel) {
          addRecentModel(selectedModel);
        }
      }

    } catch (error) {
      console.error("Error streaming chat:", error);
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: [{ type: "error", content: "Sorry, there was an error processing your request: " + error }],
        isComplete: false,
        sequence: 1,
      };
      setMessages([...newMessages, errorMessage]);
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
      streamingMessageIdRef.current = null;
    }
  };

  const triggerReload = useCallback(() => {
    setReloadTrigger(prev => prev + 1);
  }, []);

  const handleContinue = useCallback(async (messageId: string) => {
    if (!chatId) return;

    const message = messages.find(m => m.id === messageId);
    const modelUsed = message?.modelUsed;

    try {
      const response = await api.continueMessage(messageId, chatId, selectedModel || undefined);
      await streamAction(
        response,
        (content) => setMessages(prev =>
          prev.map(m => m.id === messageId ? { ...m, content, isComplete: false } : m)
        )
      );
      
      // Track model usage for recent models
      if (selectedModel) {
        addRecentModel(selectedModel);
      } else if (modelUsed) {
        addRecentModel(modelUsed);
      }
    } catch (error) {
      console.error('Failed to continue message:', error);
    }
  }, [chatId, messages, selectedModel]);

  const handleRetry = useCallback(async (messageId: string) => {
    if (!chatId) return;

    const tempId = crypto.randomUUID();
    
    setMessages(prev => {
      const retryIndex = prev.findIndex(m => m.id === messageId);
      if (retryIndex === -1) return prev;
      
      return [
        ...prev.slice(0, retryIndex),
        {
          id: tempId,
          role: 'assistant',
          content: [{ type: "text", content: "" }],
          isComplete: false,
          sequence: 1,
        } as Message,
      ];
    });

    try {
      const response = await api.retryMessage(messageId, chatId, selectedModel || undefined);
      await streamAction(
        response,
        (content) => setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { ...updated[updated.length - 1], content, isComplete: false };
          return updated;
        })
      );
      
      // Track model usage for recent models
      if (selectedModel) {
        addRecentModel(selectedModel);
      }
    } catch (error) {
      console.error('Failed to retry message:', error);
    }
  }, [chatId, selectedModel]);

  const handleEdit = useCallback(async (messageId: string) => {
    // Start inline editing for this message
    const msg = messages.find(m => m.id === messageId);
    if (!msg || msg.role !== 'user') return;

    let initial = '';
    if (typeof msg.content === 'string') {
      initial = msg.content;
    } else if (Array.isArray(msg.content)) {
      initial = msg.content
        .filter((b: any) => b?.type === 'text' && typeof b.content === 'string')
        .map((b: any) => b.content)
        .join('\n\n');
    }
    setEditingDraft(initial);
    setEditingMessageId(messageId);
  }, [chatId, messages]);

  const handleEditCancel = useCallback(() => {
    setEditingMessageId(null);
    setEditingDraft("");
  }, []);

  const handleEditSubmit = useCallback(async () => {
    const messageId = editingMessageId;
    const newContent = editingDraft.trim();
    if (!messageId || !newContent || !chatId) return;

    const userMsgId = crypto.randomUUID();
    const assistantTempId = crypto.randomUUID();

    // Optimistically replace from the edited message onward
    setMessages(prev => {
      const editIndex = prev.findIndex(m => m.id === messageId);
      if (editIndex === -1) return prev;

      return [
        ...prev.slice(0, editIndex),
        { id: userMsgId, role: 'user', content: newContent, isComplete: true, sequence: 1 } as Message,
        { id: assistantTempId, role: 'assistant', content: [{ type: 'text', content: '' }], isComplete: false, sequence: 1 } as Message,
      ];
    });

    // Exit edit mode
    setEditingMessageId(null);

    try {
      const response = await api.editUserMessage(messageId, newContent, chatId, selectedModel || undefined);
      await streamAction(
        response,
        (content) => setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { ...updated[updated.length - 1], content, isComplete: false };
          return updated;
        })
      );
      
      // Track model usage for recent models
      if (selectedModel) {
        addRecentModel(selectedModel);
      }
    } catch (error) {
      console.error('Failed to edit message:', error);
    }
  }, [chatId, editingDraft, editingMessageId, selectedModel]);

  const handleNavigate = useCallback(async (messageId: string, siblingId: string) => {
    if (!chatId) return;

    try {
      await api.switchToSibling(messageId, siblingId, chatId);
      triggerReload();
    } catch (error) {
      console.error('Failed to switch sibling:', error);
    }
  }, [chatId, triggerReload]);

  const handleStop = useCallback(async () => {
    const messageId = streamingMessageIdRef.current;
    
    if (messageId) {
      try {
        const result = await api.cancelRun(messageId);
        
        if (result.cancelled) {
          console.log(`Cancelled run for message ${messageId}`);
          
          // Reload messages from backend to sync state
          if (chatId) {
            const fullChat = await api.getChat(chatId);
            setMessages(fullChat.messages || []);
          }
        } else {
          console.log(`Run for message ${messageId} already completed`);
        }
      } catch (error) {
        console.error('Error cancelling run:', error);
      }
    }
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    streamingMessageIdRef.current = null;
    setIsLoading(false);
  }, [chatId]);

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
  };
}
