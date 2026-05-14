import { createFileRoute } from "@tanstack/react-router";
import ToolsetsPage from "@/pages/toolsets/page";

export const Route = createFileRoute("/_app/_pages/toolsets")({
  component: ToolsetsPage,
});
