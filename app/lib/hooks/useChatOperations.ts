import { useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { Message } from 'ai';
import { AllChatsData, ThinkingTime } from '@/lib/types/chat';
import { BackendChatStorageService } from '@/lib/services/backend-chat-storage';

interface UseChatOperationsProps {
  allChatsData: AllChatsData;
  setAllChatsData: (data: AllChatsData) => void;
  currentChatId: string;
  setCurrentChatId: (id: string) => void;
  setVisualChatId: (id: string) => void;
  setIsTransitioning: (transitioning: boolean) => void;
  storageService: BackendChatStorageService;
}

export function useChatOperations({
  allChatsData,
  setAllChatsData,
  currentChatId,
  setCurrentChatId,
  setVisualChatId,
  setIsTransitioning,
  storageService,
}: UseChatOperationsProps) {
  const router = useRouter();
  const navigationLock = useRef(false);

  const createNewChat = useCallback(async (chatId?: string) => {
    try {
      const newChat = await storageService.createChat(undefined, undefined, chatId);
      const newId = newChat.id!;

      const nextData: AllChatsData = {
        ...allChatsData,
        chats: {
          ...allChatsData.chats,
          [newId]: newChat,
        },
      };

      navigationLock.current = true;
      setAllChatsData(nextData);
      setVisualChatId(newId);
      setCurrentChatId(newId);
      router.push(`/?chatId=${newId}`);

      setTimeout(() => {
        navigationLock.current = false;
      }, 100);

      return newId;
    } catch (error) {
      console.error('Failed to create new chat:', error);
      throw error;
    }
  }, [allChatsData, setAllChatsData, setVisualChatId, setCurrentChatId, router, storageService]);

  const finalizeNewChat = useCallback(async (chatId: string, messages: Message[]) => {
    try {
      const newChat = await storageService.createChat(undefined, undefined, chatId);
      const updatedChat = await storageService.updateChat(chatId, { messages });

      const nextData: AllChatsData = {
        ...allChatsData,
        chats: {
          ...allChatsData.chats,
          [chatId]: updatedChat,
        },
      };

      setAllChatsData(nextData);
      setVisualChatId(chatId);
      setCurrentChatId(chatId);

      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', `/?chatId=${chatId}`);
      }
    } catch (error) {
      console.error('Failed to finalize new chat:', error);
      throw error;
    }
  }, [allChatsData, setAllChatsData, setVisualChatId, setCurrentChatId, storageService]);

  const startNewChat = useCallback(() => {
    navigationLock.current = true;
    setVisualChatId("");
    setCurrentChatId("");
    router.push("/");

    setTimeout(() => {
      const input = document.querySelector('.query-input') as HTMLTextAreaElement;
      input?.focus();
      navigationLock.current = false;
    }, 100);

    return "";
  }, [setVisualChatId, setCurrentChatId, router]);

  const switchChat = useCallback((id: string) => {
    if (id === currentChatId || !allChatsData.chats[id]) return;

    navigationLock.current = true;
    setIsTransitioning(true);
    setVisualChatId(id);

    setTimeout(() => {
      setCurrentChatId(id);
      router.push(`/?chatId=${id}`);

      setTimeout(() => {
        setIsTransitioning(false);
        navigationLock.current = false;
      }, 50);
    }, 200);
  }, [currentChatId, allChatsData, setIsTransitioning, setVisualChatId, setCurrentChatId, router]);

  const deleteChat = useCallback(async (id: string) => {
    try {
      await storageService.deleteChat(id);

      const { [id]: deletedChat, ...remainingChats } = allChatsData.chats;
      const nextData: AllChatsData = { ...allChatsData, chats: remainingChats };
      setAllChatsData(nextData);

      if (id === currentChatId) {
        const remainingIds = Object.keys(remainingChats);
        if (remainingIds.length > 0) {
          const nextId = remainingIds[0];
          setVisualChatId(nextId);
          switchChat(nextId);
        } else {
          await createNewChat();
        }
      }
    } catch (error) {
      console.error('Failed to delete chat:', error);
      throw error;
    }
  }, [allChatsData, currentChatId, setAllChatsData, setVisualChatId, switchChat, createNewChat, storageService]);

  const renameChat = useCallback(async (id: string, newTitle: string) => {
    const trimmedTitle = newTitle.trim();
    if (!trimmedTitle || !allChatsData.chats[id]) return;

    try {
      await storageService.updateChat(id, { title: trimmedTitle });

      const nextData: AllChatsData = {
        ...allChatsData,
        chats: {
          ...allChatsData.chats,
          [id]: {
            ...allChatsData.chats[id],
            title: trimmedTitle,
          },
        },
      };

      setAllChatsData(nextData);
    } catch (error) {
      console.error('Failed to rename chat:', error);
      throw error;
    }
  }, [allChatsData, setAllChatsData, storageService]);

  const updateChatMessages = useCallback(async (id: string, messages: Message[]) => {
    if (!allChatsData.chats[id]) return;

    try {
      await storageService.updateChat(id, { messages });

      const nextData: AllChatsData = {
        ...allChatsData,
        chats: {
          ...allChatsData.chats,
          [id]: {
            ...allChatsData.chats[id],
            messages: messages,
            updatedAt: new Date().toISOString(),
          },
        },
      };

      setAllChatsData(nextData);
    } catch (error) {
      console.error('Failed to update chat messages:', error);
      throw error;
    }
  }, [allChatsData, setAllChatsData, storageService]);

  const addThinkingTime = useCallback(async (id: string, messageIndex: number, thinkingTimeMs: number) => {
    if (!allChatsData.chats[id]) return;

    try {
      const newThinkingTime: ThinkingTime[] = [
        ...allChatsData.chats[id].thinkingTime,
        { index: messageIndex, time: thinkingTimeMs },
      ];

      await storageService.updateChat(id, { thinkingTime: newThinkingTime });

      const nextData: AllChatsData = {
        ...allChatsData,
        chats: {
          ...allChatsData.chats,
          [id]: {
            ...allChatsData.chats[id],
            thinkingTime: newThinkingTime,
          },
        },
      };

      setAllChatsData(nextData);
    } catch (error) {
      console.error('Failed to add thinking time:', error);
      throw error;
    }
  }, [allChatsData, setAllChatsData, storageService]);

  return {
    startNewChat,
    switchChat,
    deleteChat,
    renameChat,
    updateChatMessages,
    addThinkingTime,
    createNewChat,
    finalizeNewChat,
    navigationLock,
  };
}
