"use client";

import { memo, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { usePageTitle } from "@/contexts/page-title-context";
import { SIDEBAR_TRANSITION, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { TEST_CHAT_PANEL_TRANSITION } from "@/(app)/(pages)/agents/edit/AgentTestChatPanel";

const TITLEBAR_OFFSET_PX = 74;
const DEFAULT_PADDING_PX = 16;

function isElectrobunMac(): boolean {
  if (typeof window === "undefined") return false;
  const platform = (window as unknown as { __COVALT_ELECTROBUN_PLATFORM?: string })
    .__COVALT_ELECTROBUN_PLATFORM;
  if (platform) return platform === "darwin";
  return document.documentElement.classList.contains("electrobun-macos");
}

function HeaderInner() {
  const { title, leftContent, rightContent, floating, rightOffset } = usePageTitle();
  const { open: sidebarOpen } = useSidebar();
  const [isMacElectrobun, setIsMacElectrobun] = useState(false);
  useEffect(() => {
    const sync = () => setIsMacElectrobun(isElectrobunMac());
    sync();
    const retry = window.setTimeout(sync, 250);
    return () => window.clearTimeout(retry);
  }, []);
  const leftPadding = isMacElectrobun && !sidebarOpen ? TITLEBAR_OFFSET_PX : DEFAULT_PADDING_PX;
  const hasRightContent = rightContent != null;
  const left = leftContent != null ? (
    <>
      <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
      {leftContent}
    </>
  ) : title ? (
    <>
      <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
      <h1 className="truncate text-lg font-medium">{title}</h1>
    </>
  ) : null;

  if (floating) {
    return (
      <motion.header
        className="absolute inset-x-0 top-0 z-10 pointer-events-none p-4 flex items-start justify-between gap-4"
        initial={false}
        animate={{ paddingRight: rightOffset + DEFAULT_PADDING_PX, paddingLeft: leftPadding }}
        transition={{
          paddingLeft: SIDEBAR_TRANSITION,
          paddingRight: TEST_CHAT_PANEL_TRANSITION,
        }}
      >
        <div className="pointer-events-auto flex items-center gap-2 min-w-0 bg-background/80 backdrop-blur-sm rounded-lg px-3 py-2 border border-border shadow-sm">
          <SidebarTrigger />
          {left}
        </div>
        {hasRightContent && (
          <div className="pointer-events-auto flex items-center gap-2 shrink-0 bg-background/80 backdrop-blur-sm rounded-lg px-3 py-2 border border-border shadow-sm">
            {rightContent}
          </div>
        )}
      </motion.header>
    );
  }

  return (
    <motion.header
      className={`z-10 flex shrink-0 items-center rounded-tr-2xl gap-2 px-4 py-3 sticky top-0 w-full h-14 ${hasRightContent ? "justify-between" : ""}`}
      initial={false}
      animate={{ paddingLeft: leftPadding, paddingRight: rightOffset + DEFAULT_PADDING_PX }}
      transition={{
        paddingLeft: SIDEBAR_TRANSITION,
        paddingRight: TEST_CHAT_PANEL_TRANSITION,
      }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <SidebarTrigger />
        {left}
      </div>
      {hasRightContent && <div className="flex items-center gap-2 shrink-0">{rightContent}</div>}
    </motion.header>
  );
}

export const Header = memo(HeaderInner);
