
import { ProviderPluginSettingsSection } from "./ProviderPluginSettingsSection";

export function ProviderPluginSettingsPanel() {
  return (
    <div className="space-y-6 py-6">
      <div>
        <h1 className="text-2xl font-semibold">Plugin Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage community indexes, safety policies, and plugin installation.
        </p>
      </div>
      <ProviderPluginSettingsSection />
    </div>
  );
}
