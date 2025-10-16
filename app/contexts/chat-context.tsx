"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { ChatContextType, AllChatsData } from "@/lib/types/chat";
import { BackendChatStorageService } from "@/lib/services/backend-chat-storage";
import { useChatOperations } from "@/lib/hooks/useChatOperations";
import { useModels } from "@/lib/hooks/useModels";

const ChatContext = React.createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const [allChatsData, setAllChatsData] = React.useState<AllChatsData>({ chats: {} });
  const [currentChatId, setCurrentChatId] = React.useState("");
  const [visualChatId, setVisualChatId] = React.useState("");
  const [isTransitioning, setIsTransitioning] = React.useState(false);
  const [isLoaded, setIsLoaded] = React.useState(false);

  const storageService = React.useMemo(
    () => BackendChatStorageService.getInstance(),
    []
  );

  const { models, selectedModel, setSelectedModel } = useModels();

  const operations = useChatOperations({
    allChatsData,
    setAllChatsData,
    currentChatId,
    setCurrentChatId,
    setVisualChatId,
    setIsTransitioning,
    storageService,
  });

  React.useEffect(() => {
    const loadChats = async () => {
      try {
        const data = await storageService.load();
        setAllChatsData(data);
        setIsLoaded(true);
      } catch (error) {
        console.error("Failed to load chats:", error);
        setAllChatsData({ chats: {} });
        setIsLoaded(true);
      }
    };

    loadChats();
  }, [storageService]);

  React.useEffect(() => {
    const chatIdFromUrl = searchParams.get('chatId');
    
    if (chatIdFromUrl && chatIdFromUrl !== currentChatId) {
      setCurrentChatId(chatIdFromUrl);
      setVisualChatId(chatIdFromUrl);
    } else if (!chatIdFromUrl && currentChatId) {
      setCurrentChatId('');
      setVisualChatId('');
    }
  }, [searchParams, currentChatId]);

  const chatIds = React.useMemo(
    () => Object.keys(allChatsData.chats).sort((a, b) => {
      const chatA = allChatsData.chats[a];
      const chatB = allChatsData.chats[b];
      const timeA = new Date(chatA.updatedAt || chatA.createdAt || 0).getTime();
      const timeB = new Date(chatB.updatedAt || chatB.createdAt || 0).getTime();
      return timeB - timeA;
    }),
    [allChatsData]
  );

  const chatTitle = React.useMemo(() => {
    if (!currentChatId || !allChatsData.chats[currentChatId]) {
      return "New Chat";
    }
    return allChatsData.chats[currentChatId].title;
  }, [currentChatId, allChatsData]);

  const value = React.useMemo<ChatContextType>(
    () => ({
      chatId: currentChatId,
      visualChatId,
      chatTitle,
      chatIds,
      chatsData: allChatsData.chats,
      startNewChat: operations.startNewChat,
      createNewChat: operations.createNewChat,
      finalizeNewChat: operations.finalizeNewChat,
      switchChat: operations.switchChat,
      deleteChat: operations.deleteChat,
      renameChat: operations.renameChat,
      updateChatMessages: operations.updateChatMessages,
      addThinkingTime: operations.addThinkingTime,
      selectedModel,
      setSelectedModel,
      models,
    }),
    [
      currentChatId,
      visualChatId,
      chatTitle,
      chatIds,
      allChatsData.chats,
      operations,
      selectedModel,
      models,
    ]
  );

  if (!isLoaded) {
    return null;
  }

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = React.useContext(ChatContext);
  if (context === undefined) {
    throw new Error("useChat must be used within a ChatProvider");
  }
  return context;
}
