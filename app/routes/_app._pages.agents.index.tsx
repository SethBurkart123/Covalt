import { createFileRoute } from "@tanstack/react-router";
import AgentsPage from "@/pages/agents/page";

export const Route = createFileRoute("/_app/_pages/agents/")({
  component: AgentsPage,
});
