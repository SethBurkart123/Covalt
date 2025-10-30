"use client";

import React, { useEffect, useRef, useState } from "react";
import { useChat } from "@/contexts/chat-context";
import ChatMessageList from "./ChatMessageList";
import { api, type Message } from "@/lib/services/api";

interface ChatProps {
  messages: Message[];
  isLoading: boolean;
}

export default function Chat({ messages, isLoading }: ChatProps) {
  const AssistantMessageActions = () => {
    return <></>;
  };

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
  const abortControllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Abort stream and clear input when switching chats
  useEffect(() => {
    if (abortControllerRef.current) {
      try { abortControllerRef.current.abort(); } catch {}
      abortControllerRef.current = null;
      setIsLoading(false);
    }
    setInput("");
  }, [chatId]);

  // Load messages when chatId changes
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
  }, [chatId]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    if (!input.trim() || isLoading) return;

    const currentChatId = chatId;
    const userMessageContent = input.trim();

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: userMessageContent,
      createdAt: new Date().toISOString(),
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
              },
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
      };
      setMessages([...newMessages, errorMessage]);
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  return {
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    inputRef,
    messages,
  };
}
