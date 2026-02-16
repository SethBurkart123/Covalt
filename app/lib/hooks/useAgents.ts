import { useState, useEffect, useCallback, useRef } from "react";
import { listAgents } from "@/python/api";
import type { AgentInfo } from "@/python/api";

const agentsEqual = (a: AgentInfo[], b: AgentInfo[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].name !== b[i].name || a[i].icon !== b[i].icon || a[i].includeUserTools !== b[i].includeUserTools) return false;
  }
  return true;
};

export function useAgents() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const agentsRef = useRef(agents);

  const loadAgents = useCallback(async () => {
    try {
      const res = await listAgents();
      if (!agentsEqual(agentsRef.current, res.agents)) {
        agentsRef.current = res.agents;
        setAgents(res.agents);
      }
    } catch (error) {
      console.error("Failed to load agents:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  return { agents, isLoading, refreshAgents: loadAgents };
}
