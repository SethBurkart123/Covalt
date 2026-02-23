"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { SIDEBAR_TRANSITION, useSidebar } from "@/components/ui/sidebar";

function isElectrobunMac(): boolean {
  if (typeof window === "undefined") return false;
  const platform = (window as unknown as { __COVALT_ELECTROBUN_PLATFORM?: string })
    .__COVALT_ELECTROBUN_PLATFORM;
  if (platform) return platform === "darwin";
  return document.documentElement.classList.contains("electrobun-macos");
}

/**
 * Creates a beautifully curved cutout overlay for macOS traffic lights.
 * Uses a single animated SVG path to morph smoothly between a sweeping, 
 * constantly-curving S-notch and a standard rounded corner.
 */
export function TrafficLightOverlay() {
  const { open: sidebarOpen } = useSidebar();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const sync = () => setEnabled(isElectrobunMac());
    sync();
    const retry = window.setTimeout(sync, 250);
    return () => window.clearTimeout(retry);
  }, []);

  if (!enabled) return null;

  const showNotch = !sidebarOpen;

  const SHELF_END   = 48;   // x where the flat shelf ends and the S-curve begins
  const S_END_X     = 70;   // x where the S-curve finishes (how far right the curve goes)
  const S_HEIGHT    = 20;   // total vertical drop of the S-curve (= shelf y)
  const CORNER_R    = 16;   // FIXED: Radius of the standard rounded corner to full 16px

  const k = 0.552;                           // cubic bezier constant for quarter-ellipse
  const cornerCp = CORNER_R * (1 - k);       // FIXED: Absolute coordinate for origin-based corners

  const midX = (SHELF_END + S_END_X) / 2;    // inflection point x
  const midY = S_HEIGHT / 2;                 // inflection point y
  const hw   = midX - SHELF_END;             // half-width of S (per arc)
  const hh   = S_HEIGHT / 2;                 // half-height of S (per arc)
  const kw   = hw * k;
  const kh   = hh * k;

  // Bottom arc: (SHELF_END, S_HEIGHT) → (midX, midY)
  const c1 = `C ${SHELF_END + kw} ${S_HEIGHT}, ${midX} ${midY + kh}, ${midX} ${midY}`;
  // Top arc:   (midX, midY) → (S_END_X, 0)
  const c2 = `C ${midX} ${midY - kh}, ${S_END_X - kw} 0, ${S_END_X} 0`;

  const notchBase   = `M 0 ${CORNER_R + S_HEIGHT} C 0 ${CORNER_R + S_HEIGHT - CORNER_R * k}, ${cornerCp} ${S_HEIGHT}, ${CORNER_R} ${S_HEIGHT} L ${SHELF_END} ${S_HEIGHT} ${c1} ${c2}`;
  const borderNotch = notchBase;
  const fillNotch   = `${notchBase} L ${S_END_X} -10 L -10 -10 L -10 ${CORNER_R + S_HEIGHT} Z`;

  // STATE 2: Sidebar Open — collapse to a simple rounded corner
  const borderCorner = `M 0 ${CORNER_R} C 0 ${CORNER_R}, 0 ${CORNER_R}, 0 ${CORNER_R} L 0 ${CORNER_R} C 0 ${CORNER_R}, 0 ${CORNER_R}, 0 ${CORNER_R} C 0 ${cornerCp}, ${cornerCp} 0, ${CORNER_R} 0`;
  const fillCorner   = `${borderCorner} L ${CORNER_R} -10 L -10 -10 L -10 ${CORNER_R} Z`;

  return (
    <motion.div
      className="traffic-light-notch pointer-events-none fixed z-[100] top-2 translate-x-0"
      initial={false}
      animate={{
        left: showNotch ? 8 : "var(--sidebar-width)",
      }}
      transition={SIDEBAR_TRANSITION}
    >
      <svg
        width="100"
        height="40"
        viewBox="0 0 100 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="overflow-visible" 
      >
        <g transform="translate(0.5, 0.5)">
          <motion.path
            initial={false}
            animate={{ d: showNotch ? fillNotch : fillCorner }}
            transition={SIDEBAR_TRANSITION}
            fill="var(--sidebar)"
          />
          
          <motion.path
            initial={false}
            animate={{ d: showNotch ? borderNotch : borderCorner }}
            transition={SIDEBAR_TRANSITION}
            stroke="var(--border)"
            strokeWidth="1"
            fill="none"
          />
        </g>
      </svg>
    </motion.div>
  );
}