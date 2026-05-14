
import { useState, useMemo, useCallback, useEffect } from "react";
import { Bot, Package, PlusIcon, Settings, Loader2 } from "lucide-react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";

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
import { prefetchChat } from "@/lib/services/chat-prefetch";
import { useIsElectrobunMac } from "@/lib/hooks/use-electrobun-platform";

type SidebarRow =
  | { kind: "header"; key: string; label: string }
  | { kind: "chat"; key: string; id: string }
  | { kind: "loader"; key: "loader" };

function flattenGroups(
  groups: { label: string; chatIds: string[] }[],
  withLoader: boolean,
): SidebarRow[] {
  const rows: SidebarRow[] = [];
  for (const g of groups) {
    rows.push({ kind: "header", key: `h:${g.label}`, label: g.label });
    for (const id of g.chatIds) {
      rows.push({ kind: "chat", key: `c:${id}`, id });
    }
  }
  if (withLoader) rows.push({ kind: "loader", key: "loader" });
  return rows;
}

const ROW_ESTIMATE = 36;
const HEADER_ESTIMATE = 40;
const LOADER_ESTIMATE = 32;
const LOAD_MORE_THRESHOLD = 10;

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const navigate = useNavigate();
  const router = useRouter();
  const {
    chatId: currentChatId,
    chatIds,
    chatsLoaded,
    chatsData,
    startNewChat,
    switchChat,
    deleteChat,
    renameChat,
    toggleStarChat,
    loadMoreChats,
    hasMoreChats,
    isLoadingMoreChats,
  } = useChat();
  const { getRunState, markSeen } = useStreaming();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const handleRenameConfirm = async (id: string) => {
    if (editTitle.trim()) await renameChat(id, editTitle.trim());
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

  const rows = useMemo(
    () => flattenGroups(chatGroups, hasMoreChats),
    [chatGroups, hasMoreChats],
  );

  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const scrollRef = useCallback((node: HTMLDivElement | null) => {
    setScrollEl(node?.parentElement ?? null);
  }, []);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollEl,
    estimateSize: (i) => {
      const r = rows[i];
      if (r.kind === "header") return HEADER_ESTIMATE;
      if (r.kind === "loader") return LOADER_ESTIMATE;
      return ROW_ESTIMATE;
    },
    overscan: 8,
    getItemKey: (i) => rows[i].key,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const lastVirtualIndex = virtualItems.length
    ? virtualItems[virtualItems.length - 1].index
    : -1;

  useEffect(() => {
    if (!hasMoreChats) return;
    if (lastVirtualIndex < 0) return;
    if (lastVirtualIndex >= rows.length - LOAD_MORE_THRESHOLD) {
      void loadMoreChats();
    }
  }, [lastVirtualIndex, rows.length, hasMoreChats, loadMoreChats]);

  const handlePrefetch = useCallback((id: string) => {
    if (!id || id === currentChatId) return;
    void prefetchChat(id);
    void router.preloadRoute({ to: "/", search: { chatId: id } });
  }, [currentChatId, router]);

  const isMac = useIsElectrobunMac();

  return (
    <Sidebar variant="inset" {...props}>
      <div
        className="electrobun-webkit-app-region-drag shrink-0"
        style={{ height: isMac ? 28 : 0 }}
      />
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
        {rows.length === 0 ? (
          chatsLoaded ? (
            <div className="px-6 py-2 text-sm text-muted-foreground italic">
              No chats yet
            </div>
          ) : null
        ) : (
          <div
            ref={scrollRef}
            className="px-2 relative"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualItems.map((vi) => {
              const row = rows[vi.index];
              const style: React.CSSProperties = {
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${vi.start}px)`,
              };
              if (row.kind === "header") {
                return (
                  <div
                    key={row.key}
                    data-index={vi.index}
                    ref={virtualizer.measureElement}
                    style={style}
                    className="pt-4 pb-2 text-xs text-muted-foreground"
                  >
                    {row.label}
                  </div>
                );
              }
              if (row.kind === "loader") {
                return (
                  <div
                    key={row.key}
                    data-index={vi.index}
                    ref={virtualizer.measureElement}
                    style={style}
                    className="flex items-center justify-center py-2 text-xs text-muted-foreground"
                  >
                    {isLoadingMoreChats && (
                      <>
                        <Loader2 className="size-3 animate-spin mr-2" />
                        Loading more...
                      </>
                    )}
                  </div>
                );
              }
              const id = row.id;
              const runState = getRunState(id);
              const isEditing = editingId === id;
              return (
                <div
                  key={row.key}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  style={style}
                >
                  <ChatItem
                    title={chatsData[id]?.title || `Chat #${chatIds.indexOf(id) + 1}`}
                    isActive={currentChatId === id}
                    isStreaming={runState?.phase === "streaming" || runState?.phase === "starting"}
                    isPausedForApproval={runState?.phase === "paused_hitl"}
                    hasError={runState?.phase === "error"}
                    hasUnseenUpdate={runState?.hasUnseenUpdate ?? false}
                    isEditing={isEditing}
                    editTitle={isEditing ? editTitle : ""}
                    onEditTitleChange={setEditTitle}
                    onEditConfirm={() => handleRenameConfirm(id)}
                    onEditCancel={handleRenameCancel}
                    onSelect={() => {
                      markSeen(id);
                      switchChat(id);
                    }}
                    onPrefetch={() => handlePrefetch(id)}
                    onRename={() => {
                      setEditingId(id);
                      setEditTitle(chatsData[id]?.title || `Chat #${chatIds.indexOf(id) + 1}`);
                    }}
                    onDelete={() => deleteChat(id)}
                    isStarred={chatsData[id]?.starred ?? false}
                    onToggleStar={() => toggleStarChat(id)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </SidebarContent>

      <SidebarFooter className="relative before:content-[''] before:absolute before:pointer-events-none before:top-0 before:left-0 before:h-16 before:-translate-y-[calc(100%-1px)] before:w-full before:bg-gradient-to-b before:from-transparent before:to-sidebar">
        <SidebarMenu className="space-y-2">
          <SidebarMenuItem>
            <button
              className="px-3 py-2 flex items-center gap-2 w-full rounded-lg hover:bg-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => navigate({ to: "/agents" })}
            >
              <Bot className="size-4" />
              Agents
            </button>
            <button
              className="px-3 py-2 flex items-center gap-2 w-full rounded-lg hover:bg-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => navigate({ to: "/toolsets" })}
            >
              <Package className="size-4" />
              Toolsets
            </button>
            <button
              className="px-3 py-2 flex items-center gap-2 w-full rounded-lg hover:bg-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => navigate({ to: "/settings" })}
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
