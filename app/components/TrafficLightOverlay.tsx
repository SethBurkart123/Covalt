"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { SIDEBAR_TRANSITION, useSidebar } from "@/components/ui/sidebar";

/**
 * Creates a curved cutout overlay for macOS traffic lights.
 */
export function TrafficLightOverlay() {
  const [isMacElectron, setIsMacElectron] = useState(false);
  const { open: sidebarOpen } = useSidebar();

  useEffect(() => {
    const electronAPI = (window as any).electron;
    if (electronAPI?.platform === "darwin") {
      setIsMacElectron(true);
    }
  }, []);

  if (!isMacElectron) return null;

  const open = isMacElectron && !sidebarOpen;

  return (
    <motion.div
      className="traffic-light-notch pointer-events-none fixed z-100 top-2"
      initial={{
        left: open ? 8 : "16rem",
        x: open ? 0 : "calc(3rem)",
      }}
      animate={{
        left: open ? 8 : "16rem",
        x: open ? 0 : "calc(3rem)",
      }}
      transition={SIDEBAR_TRANSITION}
    >
      <motion.div
        className="h-8 bg-background rounded-br-2xl border-border border-b border-r relative"
        initial={{
          width: open ? 'calc(var(--spacing) * 18)' : 0,
        }}
        animate={{
          width: open ? 'calc(var(--spacing) * 18)' : 0,
        }}
        transition={SIDEBAR_TRANSITION}
      >
        <svg 
          className="size-[var(--radius-2xl)] absolute top-0 right-0 translate-x-full"
          viewBox="0 0 25 25"
          fill="none"
        >
          <path
            d="M 0 25 L 0 0 L 25 0 A 25 25 0 0 0 0 25 Z"
            fill="var(--background)"
          />
        </svg>
        <div className="size-[var(--radius-2xl)] rounded-tl-full absolute top-0 right-0 translate-x-full border-border border-t border-l"></div>

        
        <motion.div
          className="overflow-clip absolute bottom-0 left-0 translate-y-full grid"
          animate={{
            width: !open ? 0 : 'auto',
          }}
          initial={{
            width: 0,
          }}
          transition={SIDEBAR_TRANSITION}
        >
          <motion.svg 
            className="size-[var(--radius-2xl)] col-start-1 row-start-1"
            viewBox="0 0 24 24"
            fill="none"
          >
            <path
              d="M 0 24 L 0 0 L 24 0 A 24 24 0 0 0 0 24 Z"
              fill="var(--background)"
            />
          </motion.svg>
          <motion.div className="size-[var(--radius-2xl)] col-start-1 row-start-1 rounded-tl-full absolute border-border border-t border-l"></motion.div>

        </motion.div>
      </motion.div>
    </motion.div>
  );
}
