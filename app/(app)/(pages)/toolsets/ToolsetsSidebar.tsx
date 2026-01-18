"use client";

import { Package, Compass } from "lucide-react";
import { cn } from "@/lib/utils";

export type TabKey = "installed" | "browse";

interface ToolsetsSidebarProps {
  activeTab: TabKey;
  onChangeTab: (key: TabKey) => void;
}

const SIDEBAR_ITEMS: {
  key: TabKey;
  label: string;
  Icon: typeof Package;
}[] = [
  {
    label: "Installed",
    key: "installed",
    Icon: Package,
  },
  {
    label: "Browse",
    key: "browse",
    Icon: Compass,
  },
];

export default function ToolsetsSidebar({
  activeTab,
  onChangeTab,
}: ToolsetsSidebarProps) {
  return (
    <aside className="w-60 flex-shrink-0">
      <nav className="px-2 space-y-1">
        {SIDEBAR_ITEMS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => onChangeTab(key)}
            className={cn(
              "w-full px-4 py-2.5 text-sm flex items-center gap-2 select-none rounded-lg transition-colors cursor-pointer",
              activeTab === key
                ? "text-foreground bg-muted/60"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
            )}
          >
            <Icon size={16} className="text-muted-foreground" />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
