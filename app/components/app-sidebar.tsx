"use client";

import { useState, useMemo } from "react";
import { Package, PlusIcon, Settings } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useChat } from "@/contexts/chat-context";
import { useStreaming } from "@/contexts/streaming-context";
import { groupChatsByTimePeriod } from "@/lib/utils/chat-grouping";
import { ChatItem } from "@/components/ChatItem";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const router = useRouter();
  const {
    chatId: currentChatId,
    chatIds,
    chatsData,
    startNewChat,
    switchChat,
    deleteChat,
    renameChat,
    toggleStarChat,
  } = useChat();
  const { getStreamState, markChatAsSeen } = useStreaming();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const handleRenameConfirm = async (id: string) => {
    if (editTitle.trim()) {
      await renameChat(id, editTitle.trim());
    }
    setEditingId(null);
    setEditTitle("");
  };

  const handleRenameCancel = () => {
    setEditingId(null);
    setEditTitle("");
  };

  const chatGroups = useMemo(
    () => groupChatsByTimePeriod(chatIds, chatsData),
    [chatIds, chatsData]
  );

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" variant="outline" asChild>
              <button
                onClick={startNewChat}
                className="flex w-full items-center gap-3"
              >
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <PlusIcon className="size-4" />
                </div>
                <div className="flex flex-col gap-0.5 leading-none text-left">
                  <span className="font-medium text-sidebar-foreground">
                    New Chat
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Start fresh
                  </span>
                </div>
              </button>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarMenu className="gap-1 px-2 flex flex-col">
          {chatGroups.length === 0 ? (
            <SidebarMenuItem>
              <span className="px-4 py-2 text-sm text-muted-foreground italic">
                No chats yet
              </span>
            </SidebarMenuItem>
          ) : (
            chatGroups.map((group) => (
              <div key={group.label} className="contents">
                <SidebarMenuItem>
                  <div className="px-2 pt-3 pb-1 text-xs text-muted-foreground">
                    {group.label}
                  </div>
                </SidebarMenuItem>
                {group.chatIds.map((id) => {
                  const title = chatsData[id]?.title || `Chat #${chatIds.indexOf(id) + 1}`;
                  const streamState = getStreamState(id);
                  return (
                    <ChatItem
                      key={id}
                      title={title}
                      isActive={currentChatId === id}
                      isStreaming={streamState?.isStreaming ?? false}
                      isPausedForApproval={streamState?.isPausedForApproval ?? false}
                      hasError={streamState?.status === "error" || streamState?.status === "interrupted"}
                      hasUnseenUpdate={streamState?.hasUnseenUpdate ?? false}
                      isEditing={editingId === id}
                      editTitle={editTitle}
                      onEditTitleChange={setEditTitle}
                      onEditConfirm={() => handleRenameConfirm(id)}
                      onEditCancel={handleRenameCancel}
                      onSelect={() => {
                        markChatAsSeen(id);
                        switchChat(id);
                      }}
                      onRename={() => {
                        setEditingId(id);
                        setEditTitle(title);
                      }}
                      onDelete={() => deleteChat(id)}
                      isStarred={chatsData[id]?.starred ?? false}
                      onToggleStar={() => toggleStarChat(id)}
                    />
                  );
                })}
              </div>
            ))
          )}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter className="relative before:content-[''] before:absolute before:pointer-events-none before:top-0 before:left-0 before:h-16 before:-translate-y-[calc(100%-1px)] before:w-full before:bg-gradient-to-b before:from-transparent dark:before:to-background before:to-sidebar">
        <SidebarMenu className="space-y-2">
          <SidebarMenuItem>
            <button
              className="px-3 py-2 flex items-center gap-2 w-full rounded-lg hover:bg-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => router.push("/toolsets")}
            >
              <Package className="size-4" />
              Toolsets
            </button>
            <button
              className="px-3 py-2 flex items-center gap-2 w-full rounded-lg hover:bg-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => router.push("/settings")}
            >
              <Settings className="size-4" />
              Settings
            </button>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
