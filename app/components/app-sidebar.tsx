"use client";

import * as React from "react";
import { MoreVertical, PlusIcon, Pencil, Trash2, Settings, Wrench } from "lucide-react";
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
import clsx from "clsx";
import { useChat } from "@/contexts/chat-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "./ui/button";

/**
 * Sidebar that shows all stored chats and offers
 * a "New Chat" button. Uses the central ChatContext for data.
 */
export function AppSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const router = useRouter();
  const {
    chatId: currentChatId,
    chatIds,
    chatsData,
    startNewChat,
    switchChat,
    deleteChat,
    renameChat,
   } = useChat();
   
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editTitle, setEditTitle] = React.useState("");

  const handleRenameConfirm = async (id: string) => {
    if (editTitle.trim()) {
      try {
        await renameChat(id, editTitle.trim());
      } catch (error) {
        console.error('Failed to rename chat:', error);
      }
    }
    // Always exit editing mode after confirm/blur
    setEditingId(null);
    setEditTitle("");
  };

  const handleRenameCancel = () => {
      setEditingId(null);
      setEditTitle("");
  };

  // chatIds are already sorted newest first from context
  const orderedChatIds = chatIds;


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
                  <span className="font-medium text-sidebar-foreground">New Chat</span>
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
          {orderedChatIds.map((id: string) => {
            const isActive = currentChatId === id;
            const title = chatsData[id]?.title || `Chat #${chatIds.indexOf(id) + 1}`;

            return (
              <SidebarMenuItem key={id}>
                <div className="group/chat relative flex w-full items-center">
                  {editingId === id ? (
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            handleRenameConfirm(id);
                        }
                        if (e.key === "Escape") {
                            handleRenameCancel();
                        }
                      }}
                      onBlur={() => handleRenameConfirm(id)}
                      className="flex-1 px-3 py-1.5 rounded-lg bg-background text-foreground border border-border focus:outline-none focus:ring-1 focus:ring-ring h-auto text-sm"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <>
                      <button
                        onClick={() => switchChat(id)}
                        className={clsx(
                          "flex-1 truncate py-1.5 px-3 rounded-lg text-left text-sm flex items-center gap-2",
                          isActive
                           ? "bg-sidebar-accent/80 text-sidebar-accent-foreground"
                           : "hover:bg-muted/50",
                          "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        )}
                        title={title}
                      >
                        <span className="truncate">{title}</span>
                      </button>
                      <div className="absolute right-1 top-0 bottom-0 flex items-center opacity-0 group-hover/chat:opacity-100 transition-opacity duration-150">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              onClick={(e) => e.stopPropagation()}
                              className={clsx(
                                "p-1 rounded-lg hover:bg-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                                isActive ? "text-sidebar-accent-foreground" : "text-muted-foreground"
                              )}
                              aria-label={`Chat options for ${title}`}
                            >
                              <MoreVertical className="size-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                            <DropdownMenuItem
                              onClick={() => {
                                setEditingId(id);
                                setEditTitle(title);
                              }}
                            >
                              <Pencil className="mr-2 size-4" />
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={async () => {
                                try {
                                  await deleteChat(id);
                                } catch (error) {
                                  console.error('Failed to delete chat:', error);
                                }
                              }}
                              className="text-destructive focus:text-destructive focus:bg-destructive/10"
                            >
                              <Trash2 className="mr-2 size-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </>
                  )}
                </div>
              </SidebarMenuItem>
            );
          })}

          {orderedChatIds.length === 0 && (
            <SidebarMenuItem>
              <span className="px-4 py-2 text-sm text-muted-foreground italic">
                No chats yet
              </span>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter className="relative before:content-[''] before:absolute before:top-0 before:left-0 before:h-16 before:-translate-y-full before:w-full before:bg-gradient-to-b before:from-transparent before:to-background">
        <SidebarMenu className="space-y-2">
          <SidebarMenuItem>
            <button className="px-3 py-2 flex items-center gap-2 w-full rounded-lg hover:bg-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-ring" onClick={() => router.push('/settings')}>
              <Wrench className="size-4" />
              Tools
            </button>
            <button className="px-3 py-2 flex items-center gap-2 w-full rounded-lg hover:bg-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-ring" onClick={() => router.push('/settings')}>
              <Settings className="size-4" />
              Settings
            </button>
          </SidebarMenuItem>
        </SidebarMenu>

        {/* <div className="flex justify-between items-center w-full">
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              className="p-3 rounded-lg hover:bg-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-label="Settings"
              onClick={() => router.push('/settings')}
            >
              <Settings className="size-4" />
            </button>
          </div>
        </div> */}
      </SidebarFooter>
    </Sidebar>
  );
}
