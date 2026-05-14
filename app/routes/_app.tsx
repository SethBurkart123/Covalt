import type { CSSProperties } from "react";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ChatProvider } from "@/contexts/chat-context";
import { ToolsProvider } from "@/contexts/tools-context";
import { StreamingProvider } from "@/contexts/streaming-context";
import { PageTitleProvider } from "@/contexts/page-title-context";
import { WebSocketProvider } from "@/contexts/websocket-context";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";

type AppSearch = {
  chatId?: string;
};

export const Route = createFileRoute("/_app")({
  validateSearch: (search: Record<string, unknown>): AppSearch => ({
    chatId: typeof search.chatId === "string" ? search.chatId : undefined,
  }),
  component: AppLayout,
});

function AppLayout() {
  return (
    <WebSocketProvider>
      <ChatProvider>
        <ToolsProvider>
          <StreamingProvider>
            <PageTitleProvider>
              <SidebarProvider
                className="flex h-dvh w-full"
                style={{
                  "--sidebar-width": "19rem",
                  "--sidebar-half-width": "9.5rem",
                } as CSSProperties}
              >
                <AppSidebar />
                <SidebarInset className="dark:bg-card/30 shadow overflow-clip">
                  <Outlet />
                </SidebarInset>
              </SidebarProvider>
            </PageTitleProvider>
          </StreamingProvider>
        </ToolsProvider>
      </ChatProvider>
    </WebSocketProvider>
  );
}
