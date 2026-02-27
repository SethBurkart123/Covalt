"use client";

import { useEffect, useState } from "react";
import { usePageTitle } from "@/contexts/page-title-context";
import SettingsSidebar, { type TabKey, isStoreTab } from "./SettingsSidebar";
import ProvidersPanel from "./providers/ProvidersPanel";
import ProviderStorePanel from "./providers/ProviderStorePanel";
import AutoTitlePanel from "./AutoTitlePanel";
import ModelSettingsPanel from "./ModelSettingsPanel";
import SystemPromptPanel from "./SystemPromptPanel";
import { AppearancePanel } from "./appearance/AppearancePanel";

type StoreTab = "official" | "community" | "installed";

function toStoreTab(tab: TabKey): StoreTab {
  if (tab === "store:community") return "community";
  if (tab === "store:installed") return "installed";
  return "official";
}

export default function SettingsPage() {
  const { setTitle } = usePageTitle();
  const [activeTab, setActiveTab] = useState<TabKey>("providers");

  useEffect(() => {
    setTitle("Settings");
  }, [setTitle]);

  return (
    <div className="flex w-full h-full">
      <SettingsSidebar activeTab={activeTab} onChangeTab={setActiveTab} />
      <main className="flex-1 overflow-y-auto">
        <div className="container max-w-4xl px-4 mx-auto">
          {activeTab === "general" ? (
            <div className="space-y-10 py-6">
              <SystemPromptPanel />
              <AutoTitlePanel />
              <ModelSettingsPanel />
            </div>
          ) : activeTab === "appearance" ? (
            <AppearancePanel />
          ) : isStoreTab(activeTab) ? (
            <ProviderStorePanel storeTab={toStoreTab(activeTab)} />
          ) : (
            <ProvidersPanel onOpenStore={() => setActiveTab("store:official")} />
          )}
        </div>
      </main>
    </div>
  );
}
