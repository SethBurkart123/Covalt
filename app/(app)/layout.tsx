"use client";

import { Suspense } from "react";
import { ChatProvider } from "@/contexts/chat-context";
import { ToolsProvider } from "@/contexts/tools-context";
import { StreamingProvider } from "@/contexts/streaming-context";
import { PageTitleProvider } from "@/contexts/page-title-context";
import { WebSocketProvider } from "@/contexts/websocket-context";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { TrafficLightOverlay } from "@/components/TrafficLightOverlay";
import type { CSSProperties, ReactNode } from "react";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <WebSocketProvider>
      <Suspense fallback={null}>
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
                  <TrafficLightOverlay />
                  <SidebarInset className="dark:bg-card/30 border border-border shadow overflow-clip">
                    {children}
                  </SidebarInset>
                </SidebarProvider>
              </PageTitleProvider>
            </StreamingProvider>
          </ToolsProvider>
        </ChatProvider>
      </Suspense>
    </WebSocketProvider>
  );
}
