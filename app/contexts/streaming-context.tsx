"use client";

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
  type ReactNode,
} from "react";
import { connectStream as apiConnectStream, toAsyncIterable } from "@/python/api";
import {
  processEvent,
  createInitialState,
  type StreamState as ProcessorStreamState,
} from "@/lib/services/stream-processor";
import { clearPrefetchedChat } from "@/lib/services/chat-prefetch";
import { RUNTIME_EVENT } from "@/lib/services/runtime-events";
import {
  type RunPhase,
  type RunState,
  type RunEvent,
  transition,
  createIdleState,
  isActivePhase,
  isTerminalPhase,
} from "@/lib/services/chat-run-machine";

export type { RunPhase, RunState };

type PhaseChangeCallback = (chatId: string, phase: RunPhase, prevPhase: RunPhase) => void;

interface StreamingContextValue {
  runStates: Map<string, RunState>;
  getRunState: (chatId: string) => RunState | undefined;
  isRunning: (chatId: string) => boolean;
  isAnyRunning: () => boolean;
  startRun: (chatId: string, options?: { subscribe?: boolean }) => void;
  completeRun: (chatId: string) => void;
  markSeen: (chatId: string) => void;
  subscribeToChat: (chatId: string) => void;
  onPhaseChange: (callback: PhaseChangeCallback) => () => void;
  dispatchRunEvent: (chatId: string, event: RunEvent) => void;
}

const StreamingContext = createContext<StreamingContextValue | undefined>(undefined);

export function StreamingProvider({ children }: { children: ReactNode }) {
  const [runStates, setRunStates] = useState<Map<string, RunState>>(new Map());
  const subscriptionsRef = useRef<Map<string, { unsubscribe: () => void }>>(new Map());
  const processorStatesRef = useRef<Map<string, ProcessorStreamState>>(new Map());
  const isInitializedRef = useRef(false);
  const phaseCallbacksRef = useRef<Set<PhaseChangeCallback>>(new Set());

  const dispatch = useCallback((chatId: string, event: RunEvent) => {
    setRunStates((prev) => {
      const current = prev.get(chatId);
      if (!current && event.type !== "START") return prev;

      const state = current ?? createIdleState(chatId);
      const next = transition(state, event);
      if (next === state) return prev;

      const prevPhase = state.phase;
      const nextPhase = next.phase;

      if (prevPhase !== nextPhase) {
        if (isTerminalPhase(nextPhase)) {
          clearPrefetchedChat(chatId);
        }

        queueMicrotask(() => {
          phaseCallbacksRef.current.forEach((cb) => cb(chatId, nextPhase, prevPhase));
        });
      }

      const map = new Map(prev);
      if (isTerminalPhase(nextPhase) && nextPhase === "idle") {
        map.delete(chatId);
      } else {
        map.set(chatId, next);
      }
      return map;
    });
  }, []);

  const cleanupSubscription = useCallback((chatId: string) => {
    const sub = subscriptionsRef.current.get(chatId);
    if (sub) {
      sub.unsubscribe();
      subscriptionsRef.current.delete(chatId);
    }
    processorStatesRef.current.delete(chatId);
  }, []);

  const connectToStream = useCallback((chatId: string) => {
    if (subscriptionsRef.current.has(chatId)) return;

    const controller = new AbortController();
    const stream = apiConnectStream({ body: { chatId } }, { signal: controller.signal });

    subscriptionsRef.current.set(chatId, {
      unsubscribe: () => controller.abort(),
    });

    processorStatesRef.current.set(chatId, createInitialState());

    const handleEvent = (data: unknown) => {
      const eventData = data as Record<string, unknown>;
      const eventType = eventData.event as string;

      if (eventType === RUNTIME_EVENT.STREAM_SUBSCRIBED) {
        const status = eventData.status as string | undefined;
        const messageId = eventData.messageId as string | undefined;
        if (messageId) {
          dispatch(chatId, { type: "MESSAGE_ID", messageId });
        }
        if (status === "paused_hitl") {
          dispatch(chatId, { type: "PAUSED_HITL" });
        }
        return;
      }

      if (eventType === RUNTIME_EVENT.STREAM_NOT_ACTIVE) {
        cleanupSubscription(chatId);
        dispatch(chatId, { type: "STREAM_NOT_ACTIVE" });
        return;
      }

      const pState = processorStatesRef.current.get(chatId) ?? createInitialState();
      if (!processorStatesRef.current.has(chatId)) {
        processorStatesRef.current.set(chatId, pState);
      }

      processEvent(eventType, eventData, pState, {
        onUpdate: (content) => {
          dispatch(chatId, { type: "CONTENT_UPDATE", content });
        },
        onSessionId: (sessionId) => {
          dispatch(chatId, { type: "SESSION_ID", chatId: sessionId });
        },
        onMessageId: (messageId) => {
          dispatch(chatId, { type: "MESSAGE_ID", messageId });
        },
      });

      switch (eventType) {
        case RUNTIME_EVENT.APPROVAL_REQUIRED:
          dispatch(chatId, { type: "PAUSED_HITL" });
          break;
        case RUNTIME_EVENT.APPROVAL_RESOLVED:
          dispatch(chatId, { type: "RESUME_HITL" });
          break;
        case RUNTIME_EVENT.RUN_COMPLETED:
          cleanupSubscription(chatId);
          dispatch(chatId, { type: "COMPLETED" });
          break;
        case RUNTIME_EVENT.RUN_CANCELLED:
          cleanupSubscription(chatId);
          dispatch(chatId, { type: "CANCELLED" });
          break;
        case RUNTIME_EVENT.RUN_ERROR:
          cleanupSubscription(chatId);
          dispatch(chatId, {
            type: "ERROR",
            message: (eventData.content as string) || "Unknown error",
          });
          break;
      }
    };

    (async () => {
      try {
        for await (const event of toAsyncIterable(stream)) {
          if (controller.signal.aborted) break;
          handleEvent(event);
        }
      } catch {
        // stream errored or was aborted
      } finally {
        cleanupSubscription(chatId);
      }
    })();
  }, [cleanupSubscription, dispatch]);

  useEffect(() => {
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    const subs = subscriptionsRef.current;
    const pStates = processorStatesRef.current;
    return () => {
      isInitializedRef.current = false;
      subs.forEach(({ unsubscribe }) => unsubscribe());
      subs.clear();
      pStates.clear();
    };
  }, []);

  const getRunState = useCallback((chatId: string) =>
    runStates.get(chatId),
    [runStates],
  );

  const isRunning = useCallback((chatId: string) => {
    const state = runStates.get(chatId);
    return state ? isActivePhase(state.phase) : false;
  }, [runStates]);

  const isAnyRunning = useCallback(() => {
    for (const state of runStates.values()) {
      if (isActivePhase(state.phase)) return true;
    }
    return false;
  }, [runStates]);

  const startRun = useCallback(
    (chatId: string, options?: { subscribe?: boolean }) => {
      dispatch(chatId, { type: "START", chatId });
      if (options?.subscribe === false) return;
      connectToStream(chatId);
    },
    [dispatch, connectToStream],
  );

  const completeRun = useCallback((chatId: string) => {
    cleanupSubscription(chatId);
    queueMicrotask(() => {
      setRunStates((prev) => {
        if (!prev.has(chatId)) return prev;
        const next = new Map(prev);
        next.delete(chatId);
        return next;
      });
    });
  }, [cleanupSubscription]);

  const markSeen = useCallback((chatId: string) => {
    dispatch(chatId, { type: "MARK_SEEN" });
  }, [dispatch]);

  const subscribeToChat = useCallback((chatId: string) => {
    connectToStream(chatId);
  }, [connectToStream]);

  const onPhaseChange = useCallback((callback: PhaseChangeCallback) => {
    phaseCallbacksRef.current.add(callback);
    return () => { phaseCallbacksRef.current.delete(callback); };
  }, []);

  const value = useMemo<StreamingContextValue>(() => ({
    runStates,
    getRunState,
    isRunning,
    isAnyRunning,
    startRun,
    completeRun,
    markSeen,
    subscribeToChat,
    onPhaseChange,
    dispatchRunEvent: dispatch,
  }), [
    runStates,
    getRunState,
    isRunning,
    isAnyRunning,
    startRun,
    completeRun,
    markSeen,
    subscribeToChat,
    onPhaseChange,
    dispatch,
  ]);

  return (
    <StreamingContext.Provider value={value}>
      {children}
    </StreamingContext.Provider>
  );
}

export function useStreaming() {
  const context = useContext(StreamingContext);
  if (!context) throw new Error("useStreaming must be used within a StreamingProvider");
  return context;
}
