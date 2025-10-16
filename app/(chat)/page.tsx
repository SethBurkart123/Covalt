"use client";

import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { SidebarInset } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { AppSidebar } from "@/components/app-sidebar";
import { useChat } from "@/contexts/chat-context";
import ChatPanel from "@/components/ChatPanel";

export default function Home() {
  const { chatTitle } = useChat();

  return (
    <SidebarProvider
      className="flex h-dvh w-full"
      style={
        {
          "--sidebar-width": "19rem",
          "--sidebar-half-width": "9.5rem",
        } as React.CSSProperties
      }
    >
      <AppSidebar />
      <SidebarInset className="dark:bg-card/30 border border-border shadow overflow-clip flex flex-col">
        <header className="z-10 flex h-16 shrink-0 items-center rounded-tr-2xl gap-2 px-4 sticky top-0 w-full">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-[orientation=vertical]:h-4"
          />
          <h1 className="truncate text-lg font-medium">{chatTitle}</h1>
        </header>
        <ChatPanel />
      </SidebarInset>
    </SidebarProvider>
  );
}
