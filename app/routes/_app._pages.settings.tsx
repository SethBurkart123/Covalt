import { createFileRoute } from "@tanstack/react-router";
import SettingsPage from "@/pages/settings/page";

export const Route = createFileRoute("/_app/_pages/settings")({
  component: SettingsPage,
});
