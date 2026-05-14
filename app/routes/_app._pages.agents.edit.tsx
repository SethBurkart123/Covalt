import { createFileRoute } from "@tanstack/react-router";
import AgentEditorPage from "@/pages/agents/edit/page";

type AgentEditSearch = {
  id?: string;
};

export const Route = createFileRoute("/_app/_pages/agents/edit")({
  validateSearch: (search: Record<string, unknown>): AgentEditSearch => ({
    id: typeof search.id === "string" ? search.id : undefined,
  }),
  component: AgentEditorPage,
});
