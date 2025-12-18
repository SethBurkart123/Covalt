"use client";

import React from "react";
import { ChatProvider } from "@/contexts/chat-context";
import { ToolsProvider } from "@/contexts/tools-context";
import { PageTitleProvider, usePageTitle } from "@/contexts/page-title-context";
import { AppSidebar } from "@/components/app-sidebar";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

function ShellHeader() {
  const { title } = usePageTitle();
  return (
    <header className="z-10 flex h-16 shrink-0 items-center rounded-tr-2xl gap-2 px-4 sticky top-0 w-full">
      <SidebarTrigger className="-ml-1" />
      <Separator
        orientation="vertical"
        className="mr-2 data-[orientation=vertical]:h-4"
      />
      <h1 className="truncate text-lg font-medium">{title}</h1>
    </header>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ChatProvider>
      <ToolsProvider>
        <PageTitleProvider>
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
            <ShellHeader />
            {children}
          </SidebarInset>
        </SidebarProvider>
      </PageTitleProvider>
      </ToolsProvider>
    </ChatProvider>
  );
}
