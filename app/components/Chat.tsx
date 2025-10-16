"use client";

import React, { useEffect, useRef, useState } from "react";
import { useChat } from "@/contexts/chat-context";
import ChatMessageList from "./ChatMessageList";
import type { Message } from "ai";
import { backendApiService } from "@/lib/services/backend-api";

interface ChatProps {
  messages: Message[];
  isLoading: boolean;
}

export default function Chat({ messages, isLoading }: ChatProps) {
  const AssistantMessageActions = ({ messageIndex }: { messageIndex: number }) => {
    return null;
  };

  return (
    <div className="flex-1 px-4 py-6 max-w-[50rem] w-full mx-auto">
      <ChatMessageList 
        messages={messages}
        isLoading={isLoading}
        thinkingTimes={undefined}
        AssistantMessageActions={AssistantMessageActions}
      />
    </div>
  );
}

export function useChatInput() {
  const {
    chatId,
    chatsData,
    updateChatMessages,
    finalizeNewChat,
    selectedModel,
  } = useChat();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const prevChatIdRef = useRef<string>('');
  const hasHadChatIdRef = useRef(false);

  // Prevent cross-chat leaks
  useEffect(() => {
    if (abortControllerRef.current) {
      try { abortControllerRef.current.abort(); } catch {}
      abortControllerRef.current = null;
      setIsLoading(false);
    }
    setInput("");
  }, [chatId]);

  useEffect(() => {
    if (chatId === prevChatIdRef.current) {
      return;
    }
    
    const previousChatId = prevChatIdRef.current;
    const isInitialChatLoad = !hasHadChatIdRef.current && chatId;
    prevChatIdRef.current = chatId;
    if (chatId) {
      hasHadChatIdRef.current = true;
    }
    
    const loadChatMessages = async () => {
      if (!chatId) {
        setMessages([]);
        return;
      }
      
      const chatExistsInData = chatsData[chatId];
      const existingMessages = chatExistsInData?.messages || [];
      
      if (existingMessages.length > 0) {
        setMessages(existingMessages);
        return;
      }
      
      if (!previousChatId && chatExistsInData && !isInitialChatLoad) {
        return;
      }
      
      try {
        const { backendApiService } = await import('@/lib/services/backend-api');
        const fullChat = await backendApiService.getChat(chatId);
        
        if (fullChat.messages && fullChat.messages.length > 0) {
          const mappedMessages = fullChat.messages.map(msg => ({
            id: msg.id,
            role: msg.role as 'user' | 'assistant' | 'system',
            content: msg.content,
            toolCalls: msg.toolCalls,
          }));
          setMessages(mappedMessages);
        }
      } catch (error) {
        if (error instanceof Error && !error.message.includes('404')) {
          console.error('Failed to load chat messages:', error);
        }
      }
    };
    
    loadChatMessages();
  }, [chatId, chatsData]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    if (!input.trim() || isLoading) return;

    const currentChatId = chatId;
    const isNewChat = !currentChatId;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    abortControllerRef.current = new AbortController();
    let sessionId: string | null = null;

    try {
      const response = await backendApiService.streamChat(
        newMessages.map(msg => ({
          id: msg.id,
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content,
          createdAt: new Date().toISOString(),
        })),
        selectedModel,
        isNewChat ? undefined : currentChatId
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
      let messageContent = "";
      let reasoningContent = "";
      let isReasoningClosed = false;
      const toolCalls: Array<{
        id: string;
        toolName: string;
        toolArgs: Record<string, any>;
        toolResult?: string;
        isCompleted: boolean;
      }> = [];
      const toolCallsMap = new Map<string, number>();
      const buildAssistantContent = () => {
        const trimmedReasoning = reasoningContent.trim();
        let combined = "";
        if (trimmedReasoning !== "") {
          combined += `<think>${trimmedReasoning}`;
          if (isReasoningClosed) {
            combined += "</think>\n\n";
          }
        }
        combined += messageContent;
        return combined;
      };

      // Coalesce streaming updates to ~1 per frame to avoid
      // cascading re-renders across the tree on every token.
      const framePendingRef = { current: false } as { current: boolean };
      const updateAssistantMessage = () => {
        if (framePendingRef.current) return;
        framePendingRef.current = true;
        requestAnimationFrame(() => {
          framePendingRef.current = false;
          const combined = buildAssistantContent();
          setMessages(prev => {
            const withoutLast = prev.filter(m => m.id !== assistantMessageId);
            return [
              ...withoutLast,
              {
                id: assistantMessageId,
                role: "assistant",
                content: combined,
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
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
              
              if (currentEvent === "RunStarted" && parsed.session_id) {
                sessionId = parsed.session_id;
                updateAssistantMessage();
              } else if (currentEvent === "RunContent") {
                let needsUpdate = false;
                if (typeof parsed.reasoning_content === "string" && parsed.reasoning_content.trim() !== "") {
                  const incoming = parsed.reasoning_content;
                  if (incoming !== reasoningContent || isReasoningClosed) {
                    reasoningContent = incoming;
                    if (isReasoningClosed) {
                      isReasoningClosed = false;
                    }
                    needsUpdate = true;
                  }
                }
                if (parsed.content) {
                  if (reasoningContent.trim() !== "" && !isReasoningClosed) {
                    isReasoningClosed = true;
                  }
                  messageContent += parsed.content;
                  needsUpdate = true;
                }
                if (needsUpdate) {
                  updateAssistantMessage();
                }
              } else if (currentEvent === "RunResponse") {
                let needsUpdate = false;
                if (typeof parsed.reasoning_content === "string" && parsed.reasoning_content.trim() !== "") {
                  const incoming = parsed.reasoning_content;
                  if (incoming !== reasoningContent || isReasoningClosed) {
                    reasoningContent = incoming;
                    if (isReasoningClosed) {
                      isReasoningClosed = false;
                    }
                    needsUpdate = true;
                  }
                }
                if (parsed.content) {
                  if (reasoningContent.trim() !== "" && !isReasoningClosed) {
                    isReasoningClosed = true;
                  }
                  messageContent += parsed.content;
                  needsUpdate = true;
                }
                if (needsUpdate) {
                  updateAssistantMessage();
                }
              } else if (currentEvent === "RunCompleted") {
                let needsUpdate = false;
                if (typeof parsed.reasoning_content === "string" && parsed.reasoning_content.trim() !== "") {
                  const incoming = parsed.reasoning_content;
                  if (incoming !== reasoningContent) {
                    reasoningContent = incoming;
                    needsUpdate = true;
                  }
                }
                if (reasoningContent.trim() !== "" && !isReasoningClosed) {
                  isReasoningClosed = true;
                  needsUpdate = true;
                }
                if (parsed.content) {
                  if (messageContent.trim() === "") {
                    messageContent = parsed.content;
                  } else {
                    messageContent += parsed.content;
                  }
                  needsUpdate = true;
                }
                if (needsUpdate) {
                  updateAssistantMessage();
                }
              } else if (currentEvent === "ToolCallStarted") {
                const tool = parsed.tool || parsed;
                const toolName = tool.tool_name || tool.name || "Unknown";
                const toolCallId = tool.tool_call_id || crypto.randomUUID();
                const toolArgs = tool.tool_args || tool.args || tool.arguments || {};
                
                toolCalls.push({
                  id: toolCallId,
                  toolName,
                  toolArgs,
                  isCompleted: false,
                });
                toolCallsMap.set(toolCallId, toolCalls.length - 1);
                // Insert an inline marker into the assistant content so we can render
                // tool calls in-place where they occur during streaming.
                // We wrap with blank lines to separate from Markdown paragraphs.
                const marker = `\n\n<<TOOL:${toolCallId}>>\n\n`;
                if (reasoningContent.trim() !== "" && !isReasoningClosed) {
                  isReasoningClosed = true;
                }
                messageContent += marker;
                updateAssistantMessage();
              } else if (currentEvent === "ToolCallCompleted") {
                const tool = parsed.tool || parsed;
                const toolCallId = tool.tool_call_id || parsed.tool_call_id;
                const result = tool.result || parsed.result || parsed.output;
                
                if (toolCallId && toolCallsMap.has(toolCallId)) {
                  const index = toolCallsMap.get(toolCallId)!;
                  toolCalls[index].toolResult = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
                  toolCalls[index].isCompleted = true;
                }
                updateAssistantMessage();
              }
            } catch (err) {
              console.error("Failed to parse SSE data:", err, "Line:", line);
            }
          }
        }
      }

      const finalMessages = [...newMessages, {
        id: assistantMessageId,
        role: "assistant" as const,
        content: buildAssistantContent(),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      }];
      
      if (isNewChat) {
        if (!sessionId) {
          throw new Error("No session ID received from backend");
        }
        await finalizeNewChat(sessionId, finalMessages);
      } else {
        await updateChatMessages(currentChatId, finalMessages);
      }
      
    } catch (error) {
      console.error("Error streaming chat:", error);
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Sorry, there was an error processing your request.",
      };
      const errorMessages = [...newMessages, errorMessage];
      setMessages(errorMessages);
      
      if (isNewChat) {
        if (sessionId) {
          await finalizeNewChat(sessionId, errorMessages);
        }
      } else if (currentChatId) {
        await updateChatMessages(currentChatId, errorMessages);
      }
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
