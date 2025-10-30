"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@/contexts/chat-context";
import ChatMessageList from "./ChatMessageList";
import { api } from "@/lib/services/api";
import type { Message, MessageSibling } from "@/lib/types/chat";
import { MessageActions } from "./MessageActions";

interface ChatProps {
  messages: Message[];
  isLoading: boolean;
  onRefreshMessages: () => Promise<void>;
}

export default function Chat({ messages, isLoading, onRefreshMessages }: ChatProps) {
  const { chatId } = useChat();
  const [messageSiblings, setMessageSiblings] = useState<Record<string, MessageSibling[]>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);

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

  const handleContinue = useCallback(async (messageId: string) => {
    if (!chatId) return;
    
    setActionLoading(messageId);
    try {
      const response = await api.continueMessage(messageId, chatId);
      await processStreamResponse(response);
      await onRefreshMessages();
    } catch (error) {
      console.error('Failed to continue message:', error);
    } finally {
      setActionLoading(null);
    }
  }, [chatId, onRefreshMessages]);

  const handleRetry = useCallback(async (messageId: string) => {
    if (!chatId) return;
    
    setActionLoading(messageId);
    try {
      const response = await api.retryMessage(messageId, chatId);
      await processStreamResponse(response);
      await onRefreshMessages();
    } catch (error) {
      console.error('Failed to retry message:', error);
    } finally {
      setActionLoading(null);
    }
  }, [chatId, onRefreshMessages]);

  const handleEdit = useCallback(async (messageId: string) => {
    // TODO: Implement edit UI (inline textarea)
    const newContent = prompt('Edit your message:');
    if (!newContent || !chatId) return;
    
    setActionLoading(messageId);
    try {
      const response = await api.editUserMessage(messageId, newContent, chatId);
      await processStreamResponse(response);
      await onRefreshMessages();
    } catch (error) {
      console.error('Failed to edit message:', error);
    } finally {
      setActionLoading(null);
    }
  }, [chatId, onRefreshMessages]);

  const handleNavigate = useCallback(async (messageId: string, siblingId: string) => {
    if (!chatId) return;
    
    try {
      await api.switchToSibling(messageId, siblingId, chatId);
      await onRefreshMessages();
    } catch (error) {
      console.error('Failed to switch sibling:', error);
    }
  }, [chatId, onRefreshMessages]);

  const processStreamResponse = async (response: Response) => {
    // Simple stream processing - just consume the stream
    const reader = response.body?.getReader();
    if (!reader) return;
    
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  };

  const AssistantMessageActions = useCallback(({ messageIndex }: { messageIndex: number }) => {
    const message = messages[messageIndex];
    if (!message) return null;

    const siblings = messageSiblings[message.id] || [];
    
    return (
      <MessageActions
        message={message}
        siblings={siblings}
        onContinue={!message.isComplete ? () => handleContinue(message.id) : undefined}
        onRetry={message.role === 'assistant' ? () => handleRetry(message.id) : undefined}
        onEdit={message.role === 'user' ? () => handleEdit(message.id) : undefined}
        onNavigate={(siblingId) => handleNavigate(message.id, siblingId)}
        isLoading={actionLoading === message.id}
      />
    );
  }, [messages, messageSiblings, actionLoading, handleContinue, handleRetry, handleEdit, handleNavigate]);

  return (
    <div className="flex-1 px-4 py-6 max-w-[50rem] w-full mx-auto">
      <ChatMessageList 
        messages={messages}
        isLoading={isLoading}
        AssistantMessageActions={AssistantMessageActions}
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
  const abortControllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Check if we can send messages (last message must be complete)
  useEffect(() => {
    if (messages.length === 0) {
      setCanSendMessage(true);
      return;
    }
    
    const lastMessage = messages[messages.length - 1];
    setCanSendMessage(lastMessage.isComplete !== false);
  }, [messages]);

  // Abort stream and clear input when switching chats
  useEffect(() => {
    if (abortControllerRef.current) {
      try { abortControllerRef.current.abort(); } catch {}
      abortControllerRef.current = null;
      setIsLoading(false);
    }
    setInput("");
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
    let sessionId: string | null = null;

    try {
      const response = await api.streamChat(
        newMessages,
        selectedModel,
        currentChatId || undefined
      );

      if (!response.ok) {
        throw new Error(`Failed to stream chat: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      const assistantMessageId = crypto.randomUUID();
      
      // Build structured content blocks array
      const contentBlocks: any[] = [];
      let currentTextBlock = "";
      let currentReasoningBlock = "";
      
      const flushTextBlock = () => {
        if (currentTextBlock) {
          contentBlocks.push({
            type: "text",
            content: currentTextBlock
          });
          currentTextBlock = "";
        }
      };

      // Coalesce streaming updates to ~1 per frame
      const framePendingRef = { current: false } as { current: boolean };
      // Prevent post-completion UI updates from duplicating assistant message
      let streamingDone = false;
      const updateAssistantMessage = () => {
        if (streamingDone) return;
        if (framePendingRef.current) return;
        framePendingRef.current = true;
        requestAnimationFrame(() => {
          framePendingRef.current = false;
          if (streamingDone) return;
          setMessages(prev => {
            const withoutLast = prev.filter(m => m.id !== assistantMessageId);
            return [
              ...withoutLast,
              {
                id: assistantMessageId,
                role: "assistant",
                // Important: always pass a fresh array so React.memo re-renders
                content: contentBlocks.length > 0
                  ? [...contentBlocks]
                  : [{ type: "text", content: currentTextBlock + currentReasoningBlock }],
                isComplete: false,
                sequence: 1,
              } as Message,
            ];
          });
        });
      };

      updateAssistantMessage();

      let buffer = "";
      let currentEvent = "";

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

              console.log(`[DEBUG] Current Event: ${JSON.stringify(currentEvent)}`);
              
              if (currentEvent === "RunStarted" && parsed.sessionId) {
                sessionId = parsed.sessionId;
                // If we got a sessionId and didn't have a chatId, update the URL and refresh sidebar
                if (!currentChatId && sessionId) {
                  window.history.replaceState(null, '', `/?chatId=${sessionId}`);
                  // Refresh sidebar to show new chat immediately
                  refreshChats();
                }
                updateAssistantMessage();
              } 
              else if (currentEvent === "RunContent") {
                if (parsed.content) {
                  currentTextBlock += parsed.content;
                  updateAssistantMessage();
                }
              }
              else if (currentEvent === "ReasoningStarted") {
                flushTextBlock();
                updateAssistantMessage();
              }
              else if (currentEvent === "ReasoningStep") {
                if (parsed.reasoningContent) {
                  currentReasoningBlock += parsed.reasoningContent;
                  updateAssistantMessage();
                }
              }
              else if (currentEvent === "ReasoningCompleted") {
                if (currentReasoningBlock) {
                  contentBlocks.push({
                    type: "reasoning",
                    content: currentReasoningBlock,
                    isCompleted: true
                  });
                  currentReasoningBlock = "";
                }
                updateAssistantMessage();
              }
              else if (currentEvent === "ToolCallStarted") {
                flushTextBlock();
                console.log(`[DEBUG] Tool call started: ${JSON.stringify(parsed.tool)}`);
                if (parsed.tool) {
                  contentBlocks.push({
                    type: "tool_call",
                    id: parsed.tool.id,
                    toolName: parsed.tool.toolName,
                    toolArgs: parsed.tool.toolArgs,
                    isCompleted: false
                  });
                  updateAssistantMessage();
                }
              }
              else if (currentEvent === "ToolCallCompleted") {
                console.log(`[DEBUG] Tool call completed: ${JSON.stringify(parsed.tool)}`);
                if (parsed.tool) {
                  // Find and update the tool block
                  const toolBlock = [...contentBlocks].reverse().find(
                    (b: any) => b.type === "tool_call" && b.id === parsed.tool.id
                  );
                  if (toolBlock) {
                    toolBlock.toolResult = parsed.tool.toolResult;
                    toolBlock.isCompleted = true;
                  }
                  updateAssistantMessage();
                }
              }
              else if (currentEvent === "RunCompleted" || currentEvent === "RunError") {
                flushTextBlock();
                if (currentReasoningBlock) {
                  contentBlocks.push({
                    type: "reasoning",
                    content: currentReasoningBlock,
                    isCompleted: true
                  });
                }
                updateAssistantMessage();
              }
            } catch (err) {
              console.error("Failed to parse SSE data:", err, "Line:", line);
            }
          }
        }
      }

      // Reload messages from backend after streaming completes
      // This ensures we have the authoritative version
      if (sessionId || currentChatId) {
        const finalChatId = sessionId || currentChatId;
        try {
          // Mark done before fetching to avoid race with a pending rAF update
          streamingDone = true;
          const fullChat = await api.getChat(finalChatId!);
          setMessages(fullChat.messages || []);
        } catch (error) {
          console.error('Failed to reload messages after streaming:', error);
        }
      }
      
    } catch (error) {
      console.error("Error streaming chat:", error);
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: [{ type: "error", content: "Sorry, there was an error processing your request." }],
        isComplete: false,
        sequence: 1,
      };
      setMessages([...newMessages, errorMessage]);
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  const triggerReload = useCallback(() => {
    setReloadTrigger(prev => prev + 1);
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
  };
}
