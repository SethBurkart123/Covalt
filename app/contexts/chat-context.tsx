"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { ChatContextType, AllChatsData } from "@/lib/types/chat";
import { api } from "@/lib/services/api";
import { useChatOperations } from "@/lib/hooks/useChatOperations";
import { useModels } from "@/lib/hooks/useModels";

const ChatContext = React.createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const [allChatsData, setAllChatsData] = React.useState<AllChatsData>({
    chats: {},
  });
  const [currentChatId, setCurrentChatId] = React.useState("");
  const [isLoaded, setIsLoaded] = React.useState(false);

  const currentChatIdRef = React.useRef(currentChatId);
  currentChatIdRef.current = currentChatId;

  const { models, selectedModel, setSelectedModel, refreshModels } = useModels();

  const operations = useChatOperations({
    allChatsData,
    setAllChatsData,
    currentChatId,
    setCurrentChatId,
  });

  React.useEffect(() => {
    const loadChats = async () => {
      try {
        const data = await api.getAllChats();
        setAllChatsData(data);
        setIsLoaded(true);
      } catch (error) {
        console.error("Failed to load chats:", error);
        setAllChatsData({ chats: {} });
        setIsLoaded(true);
      }
    };

    loadChats();
  }, []);

  React.useEffect(() => {
    const chatIdFromUrl = searchParams.get("chatId") || "";
    if (chatIdFromUrl !== currentChatIdRef.current) {
      setCurrentChatId(chatIdFromUrl);
    }
  }, [searchParams]);

  const chatIds = React.useMemo(
    () =>
      Object.keys(allChatsData.chats).sort((a, b) => {
        const chatA = allChatsData.chats[a];
        const chatB = allChatsData.chats[b];
        const timeA = new Date(
          chatA.updatedAt || chatA.createdAt || 0,
        ).getTime();
        const timeB = new Date(
          chatB.updatedAt || chatB.createdAt || 0,
        ).getTime();
        return timeB - timeA;
      }),
    [allChatsData],
  );

  const chatTitle = React.useMemo(() => {
    if (!currentChatId || !allChatsData.chats[currentChatId]) {
      return "";
    }
    return allChatsData.chats[currentChatId].title;
  }, [currentChatId, allChatsData]);

  const refreshChats = React.useCallback(async () => {
    try {
      const data = await api.getAllChats();
      setAllChatsData(data);
    } catch (error) {
      console.error("Failed to refresh chats:", error);
    }
  }, []);

  const value = React.useMemo<ChatContextType>(
    () => ({
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
    }),
    [
      currentChatId,
      chatTitle,
      chatIds,
      allChatsData.chats,
      operations,
      refreshChats,
      selectedModel,
      models,
      refreshModels,
    ],
  );

  if (!isLoaded) {
    return null;
  }

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const context = React.useContext(ChatContext);
  if (context === undefined) {
    throw new Error("useChat must be used within a ChatProvider");
  }
  return context;
}
