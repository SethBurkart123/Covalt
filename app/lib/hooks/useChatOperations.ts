import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { AllChatsData } from "@/lib/types/chat";
import { api } from "@/lib/services/api";

interface UseChatOperationsProps {
  allChatsData: AllChatsData;
  setAllChatsData: (data: AllChatsData) => void;
  currentChatId: string;
  setCurrentChatId: (id: string) => void;
}

export function useChatOperations({
  allChatsData,
  setAllChatsData,
  currentChatId,
  setCurrentChatId,
}: UseChatOperationsProps) {
  const router = useRouter();

  const startNewChat = useCallback(() => {
    setCurrentChatId("");
    router.push("/");

    // Focus input after navigation
    setTimeout(() => {
      const input = document.querySelector(
        ".query-input",
      ) as HTMLTextAreaElement;
      input?.focus();
    }, 0);
  }, [setCurrentChatId, router]);

  const switchChat = useCallback(
    (id: string) => {
      if (id === currentChatId || !allChatsData.chats[id]) return;

      setCurrentChatId(id);
      router.push(`/?chatId=${id}`);
    },
    [currentChatId, allChatsData, setCurrentChatId, router],
  );

  const deleteChat = useCallback(
    async (id: string) => {
      try {
        await api.deleteChat(id);

        const { [id]: deletedChat, ...remainingChats } = allChatsData.chats;
        const nextData: AllChatsData = {
          ...allChatsData,
          chats: remainingChats,
        };
        setAllChatsData(nextData);

        if (id === currentChatId) {
          const remainingIds = Object.keys(remainingChats);
          if (remainingIds.length > 0) {
            switchChat(remainingIds[0]);
          } else {
            startNewChat();
          }
        }
      } catch (error) {
        console.error("Failed to delete chat:", error);
        throw error;
      }
    },
    [allChatsData, currentChatId, setAllChatsData, switchChat, startNewChat],
  );

  const renameChat = useCallback(
    async (id: string, newTitle: string) => {
      const trimmedTitle = newTitle.trim();
      if (!trimmedTitle || !allChatsData.chats[id]) return;

      try {
        await api.renameChat(id, trimmedTitle);

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
        console.error("Failed to rename chat:", error);
        throw error;
      }
    },
    [allChatsData, setAllChatsData],
  );

  return {
    startNewChat,
    switchChat,
    deleteChat,
    renameChat,
  };
}
