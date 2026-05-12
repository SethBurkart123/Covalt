"use client";

import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import type { ChatContextType, AllChatsData, ChatData } from "@/lib/types/chat";
import type { ChatPageCursor } from "@/python/api";
import { api } from "@/lib/services/api";
import { subscribeBackendBaseUrl } from "@/lib/services/backend-url";
import { useChatOperations } from "@/lib/hooks/useChatOperations";
import { useModels } from "@/lib/hooks/useModels";
import { useAgents } from "@/lib/hooks/useAgents";
import { useModelSelection } from "@/lib/hooks/use-model-selection";

const ChatContext = createContext<ChatContextType | undefined>(undefined);

const PAGE_SIZE = 50;

function indexChats(list: readonly ChatData[]): Record<string, ChatData> {
  const out: Record<string, ChatData> = {};
  for (const c of list) {
    if (c.id) out[c.id] = c;
  }
  return out;
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const [allChatsData, setAllChatsData] = useState<AllChatsData>({ chats: {} });
  const [currentChatId, setCurrentChatId] = useState<string | null>(() =>
    searchParams.has("chatId") ? searchParams.get("chatId") || "" : null,
  );
  const [isLoaded, setIsLoaded] = useState(false);

  const currentChatIdRef = useRef(currentChatId);
  currentChatIdRef.current = currentChatId;

  const pendingUrlSyncsRef = useRef(0);

  const setCurrentChatIdOptimistic = useCallback((id: string | null) => {
    if (id !== currentChatIdRef.current) {
      pendingUrlSyncsRef.current += 1;
    }
    setCurrentChatId(id);
  }, []);

  const { models, isLoading: modelsLoading, refreshModels } = useModels();
  const { agents, isLoading: agentsLoading, refreshAgents } = useAgents();
  const {
    selectedModel,
    selectionState: modelSelectionState,
    selectionSettings: modelSelectionSettings,
    setSelectedModel,
    setModelOptions,
    setVariables,
    setSelectionSettings: setModelSelectionSettings,
  } = useModelSelection({
    chatId: currentChatId,
    models,
    modelsLoading,
    agents,
    agentsLoading,
  });

  const operations = useChatOperations({
    allChatsData,
    setAllChatsData,
    currentChatId,
    setCurrentChatId: setCurrentChatIdOptimistic,
  });

  const [nextCursor, setNextCursor] = useState<ChatPageCursor | null>(null);
  const [hasMoreChats, setHasMoreChats] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const loadFirstPage = useCallback(async () => {
    const page = await api.listChatsPage(PAGE_SIZE, null, true);
    setAllChatsData({
      chats: { ...indexChats(page.starred ?? []), ...indexChats(page.chats) },
    });
    setNextCursor(page.nextCursor ?? null);
    setHasMoreChats(page.hasMore ?? false);
    setIsLoaded(true);
  }, []);

  const loadMoreChats = useCallback(async () => {
    if (isLoadingMore || !nextCursor) return;
    setIsLoadingMore(true);
    try {
      const page = await api.listChatsPage(PAGE_SIZE, nextCursor, false);
      setAllChatsData((prev) => ({
        chats: { ...prev.chats, ...indexChats(page.chats) },
      }));
      setNextCursor(page.nextCursor ?? null);
      setHasMoreChats(page.hasMore ?? false);
    } catch (error) {
      console.error("Failed to load more chats:", error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [nextCursor, isLoadingMore]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        if (!cancelled) await loadFirstPage();
      } catch (error) {
        console.error("Failed to load chats:", error);
      }
    };
    run();
    const unsubscribe = subscribeBackendBaseUrl(() => {
      if (cancelled) return;
      run();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [loadFirstPage]);

  useEffect(() => {
    const chatIdFromUrl = searchParams.has("chatId")
      ? searchParams.get("chatId") || ""
      : null;
    if (chatIdFromUrl === currentChatIdRef.current) {
      if (pendingUrlSyncsRef.current > 0) pendingUrlSyncsRef.current -= 1;
      return;
    }
    if (pendingUrlSyncsRef.current > 0) {
      pendingUrlSyncsRef.current -= 1;
      return;
    }
    setCurrentChatId(chatIdFromUrl);
  }, [searchParams]);

  const chatIds = useMemo(() => 
    Object.keys(allChatsData.chats).sort((a, b) => {
      const timeA = new Date(allChatsData.chats[a].updatedAt || allChatsData.chats[a].createdAt || 0).getTime();
      const timeB = new Date(allChatsData.chats[b].updatedAt || allChatsData.chats[b].createdAt || 0).getTime();
      return timeB - timeA;
    }),
    [allChatsData]
  );

  const chatTitle = useMemo(() => 
    currentChatId && allChatsData.chats[currentChatId] 
      ? allChatsData.chats[currentChatId].title 
      : "",
    [currentChatId, allChatsData]
  );

  const refreshChats = useCallback(async () => {
    try {
      await loadFirstPage();
    } catch (error) {
      console.error("Failed to refresh chats:", error);
    }
  }, [loadFirstPage]);

  const value = useMemo<ChatContextType>(() => ({
    chatId: currentChatId,
    chatTitle,
    chatIds,
    chatsLoaded: isLoaded,
    chatsData: allChatsData.chats,
    startNewChat: operations.startNewChat,
    switchChat: operations.switchChat,
    deleteChat: operations.deleteChat,
    renameChat: operations.renameChat,
    toggleStarChat: operations.toggleStarChat,
    refreshChats,
    loadMoreChats,
    hasMoreChats,
    isLoadingMoreChats: isLoadingMore,
    selectedModel,
    modelSelectionState,
    modelSelectionSettings,
    setSelectedModel,
    setModelOptions,
    setVariables,
    setModelSelectionSettings,
    models,
    refreshModels,
    agents,
    refreshAgents,
  }), [
    currentChatId,
    chatTitle,
    chatIds,
    isLoaded,
    allChatsData.chats,
    operations,
    refreshChats,
    loadMoreChats,
    hasMoreChats,
    isLoadingMore,
    selectedModel,
    modelSelectionState,
    modelSelectionSettings,
    models,
    refreshModels,
    setSelectedModel,
    setModelOptions,
    setVariables,
    setModelSelectionSettings,
    agents,
    refreshAgents,
  ]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) throw new Error("useChat must be used within a ChatProvider");
  return context;
}

export function useOptionalChat() {
  return useContext(ChatContext) ?? null;
}
