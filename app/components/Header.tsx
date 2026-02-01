"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { usePageTitle } from "@/contexts/page-title-context";
import { SIDEBAR_TRANSITION, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

export function Header() {
  const { title } = usePageTitle();
  const { open: sidebarOpen } = useSidebar();
  const [isMacElectron, setIsMacElectron] = useState(false);

  useEffect(() => {
    const electronAPI = (window as any).electron;
    if (electronAPI?.platform === "darwin") {
      setIsMacElectron(true);
    }
  }, []);

  return (
    <motion.header
      className="z-10 flex shrink-0 items-center rounded-tr-2xl gap-2 p-4 sticky top-0 w-full electron-drag"
      animate={{ paddingLeft: (isMacElectron && !sidebarOpen) ? 82 : 16 }}
      transition={SIDEBAR_TRANSITION}
    >
      <SidebarTrigger className="electron-no-drag" />
      {title && (
        <>
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <h1 className="truncate text-lg font-medium">{title}</h1>
        </>
      )}
    </motion.header>
  );
}