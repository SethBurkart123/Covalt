'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Bot } from 'lucide-react';
import { usePageTitle } from '@/contexts/page-title-context';
import { Button } from '@/components/ui/button';
import { listAgents, deleteAgent, type AgentInfo } from '@/python/api';
import { AgentCard } from './AgentCard';
import { AgentCardSkeleton } from './AgentCardSkeleton';
import { CreateAgentDialog } from './CreateAgentDialog';
import { DeleteAgentDialog } from './DeleteAgentDialog';

export default function AgentsPage() {
  const { setTitle } = usePageTitle();
  const router = useRouter();
  
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [agentToDelete, setAgentToDelete] = useState<AgentInfo | null>(null);

  useEffect(() => {
    setTitle('Agents');
  }, [setTitle]);

  const loadAgents = useCallback(async () => {
    try {
      const response = await listAgents();
      setAgents(response.agents);
    } catch (err) {
      console.error('Failed to load agents:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const handleCreateSuccess = useCallback((agentId: string) => {
    setCreateDialogOpen(false);
    router.push(`/agents/edit?id=${agentId}`);
  }, [router]);

  const handleDeleteClick = useCallback((agentId: string) => {
    const agent = agents.find(a => a.id === agentId);
    if (agent) {
      setAgentToDelete(agent);
      setDeleteDialogOpen(true);
    }
  }, [agents]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!agentToDelete) return;
    
    try {
      await deleteAgent({ body: { id: agentToDelete.id } });
      setAgents(prev => prev.filter(a => a.id !== agentToDelete.id));
      setDeleteDialogOpen(false);
      setAgentToDelete(null);
    } catch (err) {
      console.error('Failed to delete agent:', err);
    }
  }, [agentToDelete]);

  return (
    <div className="container max-w-6xl px-4 mx-auto py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Agents</h1>
          <p className="text-sm text-muted-foreground">
            Create and manage visual agent graphs
          </p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)} className="gap-2">
          <Plus className="size-4" />
          New Agent
        </Button>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <AgentCardSkeleton key={i} />
          ))}
        </div>
      ) : agents.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl p-12 text-center">
          <div className="flex justify-center mb-4">
            <div className="flex items-center justify-center size-12 rounded-xl bg-muted">
              <Bot className="size-6 text-muted-foreground" />
            </div>
          </div>
          <h3 className="text-lg font-medium mb-2">No agents yet</h3>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            Create your first agent to start building visual AI workflows with tools and sub-agents.
          </p>
          <Button onClick={() => setCreateDialogOpen(true)} className="gap-2">
            <Plus className="size-4" />
            Create your first agent
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onDelete={handleDeleteClick}
            />
          ))}
        </div>
      )}

      {/* Dialogs */}
      <CreateAgentDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSuccess={handleCreateSuccess}
      />
      
      <DeleteAgentDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        agent={agentToDelete}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
