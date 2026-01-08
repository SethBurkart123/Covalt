"use client";

import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ContentBlock } from "@/lib/types/chat";
import type { BridgeChannel } from "@/python/api";
import { processEvent, createInitialState, type StreamState } from "@/lib/services/stream-processor";

export type StreamStatus = 
  | "streaming" 
  | "paused_hitl" 
  | "completed" 
  | "error" 
  | "interrupted";

export interface ChatStreamState {
  isStreaming: boolean;
  isPausedForApproval: boolean;
  streamingContent: ContentBlock[];
  streamingMessageId: string | null;
  status: StreamStatus;
  errorMessage: string | null;
  hasUnseenUpdate: boolean;
}

type StreamCompleteCallback = (chatId: string) => void;

interface StreamingContextValue {
  streamStates: Map<string, ChatStreamState>;
  isStreaming: (chatId: string) => boolean;
  isAnyStreaming: () => boolean;
  getStreamState: (chatId: string) => ChatStreamState | undefined;
  markChatAsSeen: (chatId: string) => void;
  clearStreamRecord: (chatId: string) => Promise<void>;
  subscribeToStream: (chatId: string) => void;
  registerStream: (chatId: string, messageId: string) => void;
  unregisterStream: (chatId: string) => void;
  updateStreamContent: (chatId: string, content: ContentBlock[]) => void;
  onStreamComplete: (callback: StreamCompleteCallback) => () => void;
}

const StreamingContext = React.createContext<StreamingContextValue | undefined>(undefined);

export function StreamingProvider({ children }: { children: React.ReactNode }) {
  const [streamStates, setStreamStates] = useState<Map<string, ChatStreamState>>(new Map());
  const subscriptionsRef = useRef<Map<string, { channel: BridgeChannel<unknown>; unsubscribe: () => void }>>(new Map());
  const streamStateRefs = useRef<Map<string, StreamState>>(new Map());
  const isInitializedRef = useRef(false);
  const completeCallbacksRef = useRef<Set<StreamCompleteCallback>>(new Set());

  const subscribeToStreamInternal = useCallback(async (chatId: string) => {
    if (subscriptionsRef.current.has(chatId)) {
      return;
    }

    try {
      const apiModule = await import("@/python/api");
      const api = apiModule as Record<string, unknown>;
      
      if (typeof api.subscribeToStream !== "function") {
        console.warn("[StreamingContext] api.subscribeToStream not available yet");
        return;
      }

      const channel = (api.subscribeToStream as (args: { body: { chatId: string } }) => BridgeChannel<unknown>)({ body: { chatId } });
      
      if (!channel) {
        console.error(`[StreamingContext] Failed to create subscription channel for ${chatId}`);
        return;
      }

      console.log(`[StreamingContext] Created subscription for ${chatId}`);
      subscriptionsRef.current.set(chatId, {
        channel,
        unsubscribe: () => channel.close?.(),
      });

      streamStateRefs.current.set(chatId, createInitialState());

      const handleEvent = (data: unknown) => {
        const eventData = data as Record<string, unknown>;
        const eventType = eventData.event as string;
        
        console.log(`[StreamingContext] Received event for ${chatId}:`, eventType);

        let streamState = streamStateRefs.current.get(chatId);
        if (!streamState) {
          streamState = createInitialState();
          streamStateRefs.current.set(chatId, streamState);
        }

        processEvent(eventType, eventData, streamState, {
          onUpdate: (content) => {
            setStreamStates((prev) => {
              const current = prev.get(chatId);
              if (!current) return prev;
              
              const next = new Map(prev);
              next.set(chatId, {
                ...current,
                streamingContent: content,
                isStreaming: true,
                status: "streaming",
              });
              return next;
            });
          },
          onSessionId: (sessionId) => {
            console.log(`[StreamingContext] Session ID for ${chatId}:`, sessionId);
          },
          onMessageId: (messageId) => {
            console.log(`[StreamingContext] Message ID for ${chatId}:`, messageId);
            setStreamStates((prev) => {
              const current = prev.get(chatId);
              if (!current) return prev;
              
              const next = new Map(prev);
              next.set(chatId, {
                ...current,
                streamingMessageId: messageId,
              });
              return next;
            });
          },
        });

        switch (eventType) {
          case "StreamNotActive":
            console.log(`[StreamingContext] Stream not active for ${chatId}`);
            subscriptionsRef.current.get(chatId)?.unsubscribe();
            subscriptionsRef.current.delete(chatId);
            streamStateRefs.current.delete(chatId);
            setStreamStates((prev) => {
              const next = new Map(prev);
              next.delete(chatId);
              return next;
            });
            break;

          case "ToolApprovalRequired":
            console.log(`[StreamingContext] Tool approval required for ${chatId}`);
            setStreamStates((prev) => {
              const current = prev.get(chatId);
              if (!current) return prev;
              
              const next = new Map(prev);
              next.set(chatId, {
                ...current,
                isStreaming: false,
                isPausedForApproval: true,
                status: "paused_hitl",
              });
              return next;
            });
            break;

          case "ToolApprovalResolved":
            setStreamStates((prev) => {
              const current = prev.get(chatId);
              if (!current) return prev;
              
              const next = new Map(prev);
              next.set(chatId, {
                ...current,
                isStreaming: true,
                isPausedForApproval: false,
                status: "streaming",
              });
              return next;
            });
            break;

          case "RunCompleted":
          case "RunCancelled":
            // Don't delete stream state here - let the original sender's code path
            // (handleSubmit/handleContinue/etc.) handle cleanup via unregisterStream().
            // This prevents a race condition where the WebSocket event arrives before
            // the stream processor finishes, causing the message to briefly disappear.
            console.log(`[StreamingContext] Stream completed for ${chatId} (cleanup handled by sender)`);
            subscriptionsRef.current.get(chatId)?.unsubscribe();
            subscriptionsRef.current.delete(chatId);
            break;

          case "RunError":
            console.log(`[StreamingContext] Stream error for ${chatId}:`, eventData.content);
            subscriptionsRef.current.get(chatId)?.unsubscribe();
            subscriptionsRef.current.delete(chatId);
            streamStateRefs.current.delete(chatId);
            setStreamStates((prev) => {
              const next = new Map(prev);
              next.delete(chatId);
              return next;
            });
            completeCallbacksRef.current.forEach(cb => cb(chatId));
            break;
        }
      };

      channel.subscribe(handleEvent);
      
      channel.onError?.((error: unknown) => {
        console.error(`[StreamingContext] Stream subscription error for ${chatId}:`, error);
        subscriptionsRef.current.delete(chatId);
        streamStateRefs.current.delete(chatId);
      });

      channel.onClose?.(() => {
        console.log(`[StreamingContext] Stream subscription closed for ${chatId}`);
        subscriptionsRef.current.delete(chatId);
        streamStateRefs.current.delete(chatId);
      });

    } catch (error) {
      console.error(`[StreamingContext] Failed to subscribe to stream for ${chatId}:`, error);
    }
  }, []);

  useEffect(() => {
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    const loadActiveStreams = async () => {
      try {
        const apiModule = await import("@/python/api");
        const api = apiModule as Record<string, unknown>;
        
        if (typeof api.getActiveStreams !== "function") {
          console.warn("[StreamingContext] api.getActiveStreams not available yet");
          return;
        }

        const response = await (api.getActiveStreams as () => Promise<{ streams: Array<{ chatId: string; messageId: string; status: string; errorMessage?: string }> }>)();
        const newStates = new Map<string, ChatStreamState>();

        console.log("[StreamingContext] Loaded active streams:", response.streams);

        for (const stream of response.streams) {
          const isActive = stream.status === "streaming" || stream.status === "paused_hitl";
          
          newStates.set(stream.chatId, {
            isStreaming: stream.status === "streaming",
            isPausedForApproval: stream.status === "paused_hitl",
            streamingContent: [],
            streamingMessageId: stream.messageId,
            status: stream.status as StreamStatus,
            errorMessage: stream.errorMessage || null,
            hasUnseenUpdate: !isActive,
          });

          if (isActive) {
            console.log(`[StreamingContext] Subscribing to active stream: ${stream.chatId}`);
            subscribeToStreamInternal(stream.chatId);
          }
        }

        setStreamStates(newStates);
      } catch (error) {
        console.error("[StreamingContext] Failed to load active streams:", error);
      }
    };

    loadActiveStreams();

    return () => {
      subscriptionsRef.current.forEach(({ unsubscribe }) => unsubscribe());
      subscriptionsRef.current.clear();
      streamStateRefs.current.clear();
      isInitializedRef.current = false;
    };
  }, [subscribeToStreamInternal]);

  const isStreaming = useCallback((chatId: string): boolean => {
    const state = streamStates.get(chatId);
    return state?.isStreaming ?? false;
  }, [streamStates]);

  const isAnyStreaming = useCallback((): boolean => {
    for (const state of streamStates.values()) {
      if (state.isStreaming) return true;
    }
    return false;
  }, [streamStates]);

  const getStreamState = useCallback((chatId: string): ChatStreamState | undefined => {
    return streamStates.get(chatId);
  }, [streamStates]);

  const markChatAsSeen = useCallback((chatId: string) => {
    setStreamStates((prev) => {
      const current = prev.get(chatId);
      if (!current || !current.hasUnseenUpdate) return prev;

      const next = new Map(prev);
      next.set(chatId, { ...current, hasUnseenUpdate: false });
      return next;
    });
  }, []);

  const clearStreamRecord = useCallback(async (chatId: string) => {
    try {
      const apiModule = await import("@/python/api");
      const api = apiModule as Record<string, unknown>;
      
      if (typeof api.clearStreamRecord === "function") {
        await (api.clearStreamRecord as (args: { body: { chatId: string } }) => Promise<unknown>)({ body: { chatId } });
      }
      
      setStreamStates((prev) => {
        const next = new Map(prev);
        next.delete(chatId);
        return next;
      });
    } catch (error) {
      console.error("Failed to clear stream record:", error);
    }
  }, []);

  const subscribeToStream = useCallback((chatId: string) => {
    subscribeToStreamInternal(chatId);
  }, [subscribeToStreamInternal]);

  const registerStream = useCallback((chatId: string, messageId: string) => {
    console.log(`[StreamingContext] Registering stream for ${chatId}, message ${messageId}`);
    streamStateRefs.current.set(chatId, createInitialState());
    
    setStreamStates((prev) => {
      const next = new Map(prev);
      next.set(chatId, {
        isStreaming: true,
        isPausedForApproval: false,
        streamingContent: [],
        streamingMessageId: messageId,
        status: "streaming",
        errorMessage: null,
        hasUnseenUpdate: false,
      });
      return next;
    });
  }, []);

  const unregisterStream = useCallback((chatId: string) => {
    console.log(`[StreamingContext] Unregistering stream for ${chatId}`);
    streamStateRefs.current.delete(chatId);
    
    subscriptionsRef.current.get(chatId)?.unsubscribe();
    subscriptionsRef.current.delete(chatId);
    
    setStreamStates((prev) => {
      const next = new Map(prev);
      next.delete(chatId);
      return next;
    });

    completeCallbacksRef.current.forEach(cb => cb(chatId));
  }, []);

  const updateStreamContent = useCallback((chatId: string, content: ContentBlock[]) => {
    setStreamStates((prev) => {
      const current = prev.get(chatId);
      if (!current) return prev;

      const next = new Map(prev);
      next.set(chatId, {
        ...current,
        streamingContent: content,
      });
      return next;
    });
  }, []);

  const onStreamComplete = useCallback((callback: StreamCompleteCallback) => {
    completeCallbacksRef.current.add(callback);
    return () => {
      completeCallbacksRef.current.delete(callback);
    };
  }, []);

  const value = React.useMemo<StreamingContextValue>(
    () => ({
      streamStates,
      isStreaming,
      isAnyStreaming,
      getStreamState,
      markChatAsSeen,
      clearStreamRecord,
      subscribeToStream,
      registerStream,
      unregisterStream,
      updateStreamContent,
      onStreamComplete,
    }),
    [
      streamStates,
      isStreaming,
      isAnyStreaming,
      getStreamState,
      markChatAsSeen,
      clearStreamRecord,
      subscribeToStream,
      registerStream,
      unregisterStream,
      updateStreamContent,
      onStreamComplete,
    ]
  );

  return (
    <StreamingContext.Provider value={value}>
      {children}
    </StreamingContext.Provider>
  );
}

export function useStreaming() {
  const context = React.useContext(StreamingContext);
  if (context === undefined) {
    throw new Error("useStreaming must be used within a StreamingProvider");
  }
  return context;
}

export function useChatStreamState(chatId: string | undefined) {
  const { getStreamState, markChatAsSeen, subscribeToStream } = useStreaming();
  
  useEffect(() => {
    if (chatId) {
      markChatAsSeen(chatId);
      subscribeToStream(chatId);
    }
  }, [chatId, markChatAsSeen, subscribeToStream]);

  if (!chatId) return undefined;
  return getStreamState(chatId);
}
