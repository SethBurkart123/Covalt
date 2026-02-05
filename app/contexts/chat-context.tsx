"use client";

import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import type { ChatContextType, AllChatsData } from "@/lib/types/chat";
import { api } from "@/lib/services/api";
import { useChatOperations } from "@/lib/hooks/useChatOperations";
import { useModels } from "@/lib/hooks/useModels";

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const [allChatsData, setAllChatsData] = useState<AllChatsData>({ chats: {} });
  const [currentChatId, setCurrentChatId] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);

  const currentChatIdRef = useRef(currentChatId);
  currentChatIdRef.current = currentChatId;

  const { models, selectedModel, setSelectedModel, refreshModels } = useModels();

  const operations = useChatOperations({
    allChatsData,
    setAllChatsData,
    currentChatId,
    setCurrentChatId,
  });

  useEffect(() => {
    const loadChats = async () => {
      try {
        setAllChatsData(await api.getAllChats());
      } catch (error) {
        console.error("Failed to load chats:", error);
        setAllChatsData({ chats: {} });
      } finally {
        setIsLoaded(true);
      }
    };
    loadChats();
  }, []);

  useEffect(() => {
    const chatIdFromUrl = searchParams.get("chatId") || "";
    if (chatIdFromUrl !== currentChatIdRef.current) {
      setCurrentChatId(chatIdFromUrl);
    }
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
      setAllChatsData(await api.getAllChats());
    } catch (error) {
      console.error("Failed to refresh chats:", error);
    }
  }, []);

  const value = useMemo<ChatContextType>(() => ({
    chatId: currentChatId,
    chatTitle,
    chatIds,
    chatsData: allChatsData.chats,
    startNewChat: operations.startNewChat,
    switchChat: operations.switchChat,
    deleteChat: operations.deleteChat,
    renameChat: operations.renameChat,
    toggleStarChat: operations.toggleStarChat,
    refreshChats,
    selectedModel,
    setSelectedModel,
    models,
    refreshModels,
  }), [
    currentChatId,
    chatTitle,
    chatIds,
    allChatsData.chats,
    operations,
    refreshChats,
    selectedModel,
    models,
    refreshModels,
    setSelectedModel,
  ]);

  if (!isLoaded) return null;

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
