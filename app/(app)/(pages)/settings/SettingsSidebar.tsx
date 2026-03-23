"use client";

import React, { type ReactNode } from "react";
import { Boxes, Settings, Palette, Store, Plug } from "lucide-react";
import { cn } from "@/lib/utils";

export type TabKey =
  | "general"
  | "providers"
  | "providers:store"
  | "providers:plugins"
  | "appearance";

export function isProvidersSection(tab: TabKey): boolean {
  return tab === "providers" || tab.startsWith("providers:");
}

interface SettingsSidebarProps {
  activeTab: TabKey;
  onChangeTab?: (key: TabKey) => void;
}

interface SidebarItemConfig {
  icon: ReactNode;
  label: string;
  tabKey: TabKey;
  subItems?: { icon: ReactNode; label: string; tabKey: TabKey }[];
}

const SIDEBAR_ITEMS: SidebarItemConfig[] = [
  {
    icon: <Settings size={16} />,
    label: "General",
    tabKey: "general",
  },
  {
    icon: <Boxes size={16} />,
    label: "Providers",
    tabKey: "providers",
    subItems: [
      { icon: <Store size={14} />, label: "Store", tabKey: "providers:store" },
      { icon: <Plug size={14} />, label: "Plugin Settings", tabKey: "providers:plugins" },
    ],
  },
  {
    icon: <Palette size={16} />,
    label: "Appearance",
    tabKey: "appearance",
  },
];

export default function SettingsSidebar({
  activeTab,
  onChangeTab,
}: SettingsSidebarProps) {
  const isProvidersActive = isProvidersSection(activeTab);

  return (
    <aside className="w-60">
      <nav className="px-2 space-y-1">
        {SIDEBAR_ITEMS.map((item) => {
          const isParentActive = item.subItems
            ? isProvidersActive
            : activeTab === item.tabKey;

          return (
            <div key={item.tabKey}>
              <div
                onClick={() => onChangeTab?.(item.tabKey)}
                className={cn(
                  "px-4 py-2.5 text-sm flex items-center gap-2 select-none rounded-lg transition-colors",
                  onChangeTab ? "cursor-pointer" : "cursor-default",
                  isParentActive
                    ? "text-foreground bg-muted/60"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
                )}
              >
                <span className="text-muted-foreground">{item.icon}</span>
                <span>{item.label}</span>
              </div>

              {item.subItems && isProvidersActive && (
                <div className="ml-4 mt-0.5 space-y-0.5">
                  {item.subItems.map((sub) => (
                    <div
                      key={sub.tabKey}
                      onClick={() => onChangeTab?.(sub.tabKey)}
                      className={cn(
                        "px-3 py-1.5 text-sm flex items-center gap-2 select-none rounded-md transition-colors",
                        onChangeTab ? "cursor-pointer" : "cursor-default",
                        activeTab === sub.tabKey
                          ? "text-foreground bg-muted/40"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/30",
                      )}
                    >
                      <span className="text-muted-foreground">{sub.icon}</span>
                      <span>{sub.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
