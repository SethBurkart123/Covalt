import { useCallback, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { AllChatsData } from "@/lib/types/chat";
import { api } from "@/lib/services/api";
import { prefetchChat } from "@/lib/services/chat-prefetch";

interface UseChatOperationsProps {
  allChatsData: AllChatsData;
  setAllChatsData: Dispatch<SetStateAction<AllChatsData>>;
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

      void prefetchChat(id);
      setCurrentChatId(id);
      router.push(`/?chatId=${id}`);
    },
    [currentChatId, allChatsData, setCurrentChatId, router],
  );

  const deleteChat = useCallback(
    async (id: string) => {
      await api.deleteChat(id);

      let nextChatId: string | null = null;
      let shouldSwitch = false;

      setAllChatsData((prev) => {
        if (!prev.chats[id]) return prev;
        const remainingChats = { ...prev.chats };
        delete remainingChats[id];

        if (id === currentChatId) {
          shouldSwitch = true;
          const remainingIds = Object.keys(remainingChats);
          nextChatId = remainingIds.length > 0 ? remainingIds[0] : null;
        }

        return {
          ...prev,
          chats: remainingChats,
        };
      });

      if (shouldSwitch) {
        if (nextChatId) {
          switchChat(nextChatId);
        } else {
          startNewChat();
        }
      }
    },
    [currentChatId, setAllChatsData, switchChat, startNewChat],
  );

  const renameChat = useCallback(
    async (id: string, newTitle: string) => {
      const trimmedTitle = newTitle.trim();
      if (!trimmedTitle) return;

      await api.renameChat(id, trimmedTitle);
      setAllChatsData((prev) => {
        if (!prev.chats[id]) return prev;
        return {
          ...prev,
          chats: {
            ...prev.chats,
            [id]: {
              ...prev.chats[id],
              title: trimmedTitle,
            },
          },
        };
      });
    },
    [setAllChatsData],
  );

  const toggleStarChat = useCallback(
    async (id: string) => {
      const updatedChat = await api.toggleStarChat(id);
      setAllChatsData((prev) => {
        if (!prev.chats[id]) return prev;
        return {
          ...prev,
          chats: {
            ...prev.chats,
            [id]: {
              ...prev.chats[id],
              starred: updatedChat.starred,
            },
          },
        };
      });
    },
    [setAllChatsData],
  );

  return {
    startNewChat,
    switchChat,
    deleteChat,
    renameChat,
    toggleStarChat,
  };
}
