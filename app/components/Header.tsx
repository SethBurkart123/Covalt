"use client";

import { memo } from "react";
import { motion } from "framer-motion";
import { usePageTitle } from "@/contexts/page-title-context";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

const TRANSITION = {
  type: "spring" as const,
  stiffness: 231,
  damping: 28,
};

function HeaderInner() {
  const { title, leftContent, rightContent, floating, rightOffset } = usePageTitle();
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
        animate={{ paddingRight: rightOffset + 16 }}
        transition={TRANSITION}
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
    <header
      className={`z-10 flex shrink-0 items-center rounded-tr-2xl gap-2 px-4 py-3 sticky top-0 w-full h-14 ${hasRightContent ? "justify-between" : ""}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <SidebarTrigger />
        {left}
      </div>
      {hasRightContent && <div className="flex items-center gap-2 shrink-0">{rightContent}</div>}
    </header>
  );
}

export const Header = memo(HeaderInner);
