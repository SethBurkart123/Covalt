import type { ChatData } from "@/lib/types/chat";

export type ChatGroup = {
  label: string;
  chatIds: string[];
};

export function groupChatsByTimePeriod(
  chatIds: string[],
  chatsData: Record<string, ChatData>
): ChatGroup[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const thisWeek = new Date(today);
  thisWeek.setDate(thisWeek.getDate() - 7);
  const thisMonth = new Date(today);
  thisMonth.setMonth(thisMonth.getMonth() - 1);

  const groups: ChatGroup[] = [];
  const todayChats: string[] = [];
  const yesterdayChats: string[] = [];
  const thisWeekChats: string[] = [];
  const thisMonthChats: string[] = [];
  const olderChats: Map<string, string[]> = new Map();

  for (const chatId of chatIds) {
    const chat = chatsData[chatId];
    if (!chat) continue;

    const updatedAt = chat.updatedAt || chat.createdAt;
    if (!updatedAt) {
      olderChats.set("Unknown", [
        ...(olderChats.get("Unknown") || []),
        chatId,
      ]);
      continue;
    }

    const chatDate = new Date(updatedAt);
    const chatDateOnly = new Date(
      chatDate.getFullYear(),
      chatDate.getMonth(),
      chatDate.getDate()
    );

    if (chatDateOnly.getTime() === today.getTime()) {
      todayChats.push(chatId);
    } else if (chatDateOnly.getTime() === yesterday.getTime()) {
      yesterdayChats.push(chatId);
    } else if (chatDate >= thisWeek) {
      thisWeekChats.push(chatId);
    } else if (chatDate >= thisMonth) {
      thisMonthChats.push(chatId);
    } else {
      const monthKey = chatDate.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      });
      const existing = olderChats.get(monthKey) || [];
      existing.push(chatId);
      olderChats.set(monthKey, existing);
    }
  }

  if (todayChats.length > 0) {
    groups.push({ label: "Today", chatIds: todayChats });
  }
  if (yesterdayChats.length > 0) {
    groups.push({ label: "Yesterday", chatIds: yesterdayChats });
  }
  if (thisWeekChats.length > 0) {
    groups.push({ label: "This Week", chatIds: thisWeekChats });
  }
  if (thisMonthChats.length > 0) {
    groups.push({ label: "This Month", chatIds: thisMonthChats });
  }

  const sortedMonths = Array.from(olderChats.entries()).sort((a, b) => {
    if (a[0] === "Unknown") return 1;
    if (b[0] === "Unknown") return -1;
    
    const chatA = chatsData[a[1][0]];
    const chatB = chatsData[b[1][0]];
    const dateA = new Date(chatA?.updatedAt || chatA?.createdAt || 0);
    const dateB = new Date(chatB?.updatedAt || chatB?.createdAt || 0);
    return dateB.getTime() - dateA.getTime();
  });

  for (const [monthKey, chatIds] of sortedMonths) {
    groups.push({ label: monthKey, chatIds });
  }

  return groups;
}

