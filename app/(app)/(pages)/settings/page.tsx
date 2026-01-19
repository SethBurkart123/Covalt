"use client";

import { useEffect, useState } from "react";
import { usePageTitle } from "@/contexts/page-title-context";
import SettingsSidebar, { type TabKey } from "./SettingsSidebar";
import ProvidersPanel from "./providers/ProvidersPanel";
import AutoTitlePanel from "./AutoTitlePanel";
import ModelSettingsPanel from "./ModelSettingsPanel";
import { AppearancePanel } from "./appearance/AppearancePanel";

export default function SettingsPage() {
  const { setTitle } = usePageTitle();
  const [activeTab, setActiveTab] = useState<TabKey>("providers");

  useEffect(() => {
    setTitle("Settings");
  }, [setTitle]);

  const renderContent = () => {
    switch (activeTab) {
      case "general":
        return (
          <div className="space-y-4">
            <AutoTitlePanel />
            <ModelSettingsPanel />
          </div>
        );
      case "providers":
        return <ProvidersPanel />;
      case "appearance":
        return <AppearancePanel />;
      default:
        return <ProvidersPanel />;
    }
  };

  return (
    <div className="flex w-full h-full">
      <SettingsSidebar activeTab={activeTab} onChangeTab={setActiveTab} />
      <main className="flex-1 overflow-y-auto">
        <div className="container max-w-4xl px-4 mx-auto">
          {renderContent()}
        </div>
      </main>
    </div>
  );
}
