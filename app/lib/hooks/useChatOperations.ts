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

    setTimeout(() => {
      const input = document.querySelector(".query-input") as HTMLElement | null;
      input?.focus?.();
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
      await api.deleteChat(id);

      const { [id]: _deletedChat, ...remainingChats } = allChatsData.chats;
      setAllChatsData({
        ...allChatsData,
        chats: remainingChats,
      });

      if (id === currentChatId) {
        const remainingIds = Object.keys(remainingChats);
        if (remainingIds.length > 0) {
          switchChat(remainingIds[0]);
        } else {
          startNewChat();
        }
      }
    },
    [allChatsData, currentChatId, setAllChatsData, switchChat, startNewChat],
  );

  const renameChat = useCallback(
    async (id: string, newTitle: string) => {
      const trimmedTitle = newTitle.trim();
      if (!trimmedTitle || !allChatsData.chats[id]) return;

      await api.renameChat(id, trimmedTitle);
      setAllChatsData({
        ...allChatsData,
        chats: {
          ...allChatsData.chats,
          [id]: {
            ...allChatsData.chats[id],
            title: trimmedTitle,
          },
        },
      });
    },
    [allChatsData, setAllChatsData],
  );

  const toggleStarChat = useCallback(
    async (id: string) => {
      if (!allChatsData.chats[id]) return;

      const updatedChat = await api.toggleStarChat(id);
      setAllChatsData({
        ...allChatsData,
        chats: {
          ...allChatsData.chats,
          [id]: {
            ...allChatsData.chats[id],
            starred: updatedChat.starred,
          },
        },
      });
    },
    [allChatsData, setAllChatsData],
  );

  return {
    startNewChat,
    switchChat,
    deleteChat,
    renameChat,
    toggleStarChat,
  };
}
