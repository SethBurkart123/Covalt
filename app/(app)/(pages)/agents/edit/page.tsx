'use client';

import { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Loader2, AlertCircle } from 'lucide-react';
import { FlowProvider, useSelection } from '@/lib/flow';
import { FlowCanvas, PropertiesPanel } from '@/components/flow';
import { AgentEditorProvider, useAgentEditor } from '@/contexts/agent-editor-context';
import { AgentEditorHeader } from './AgentEditorHeader';
import { AgentSettingsDialog } from './AgentSettingsDialog';
import { Button } from '@/components/ui/button';

function AgentEditorContent() {
  const router = useRouter();
  const { isLoading, loadError, agent } = useAgentEditor();
  const { selectedNodeId } = useSelection();
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Loading agent...</p>
        </div>
      </div>
    );
  }

  if (loadError || !agent) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center max-w-md">
          <div className="flex items-center justify-center size-12 rounded-full bg-destructive/10">
            <AlertCircle className="size-6 text-destructive" />
          </div>
          <h2 className="text-lg font-medium">Agent not found</h2>
          <p className="text-muted-foreground">
            {loadError || "The agent you're looking for doesn't exist or has been deleted."}
          </p>
          <Button onClick={() => router.push('/agents')}>
            Back to Agents
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      <AgentEditorHeader onOpenSettings={() => setSettingsOpen(true)} />
      
      <div className="flex-1 relative">
        <FlowCanvas />
        
        {selectedNodeId && (
          <div className="absolute top-4 right-4 w-80 z-10">
            <PropertiesPanel />
          </div>
        )}
      </div>

      <AgentSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
    </div>
  );
}

export default function AgentEditorPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const agentId = searchParams.get('id');

  if (!agentId) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center max-w-md">
          <div className="flex items-center justify-center size-12 rounded-full bg-destructive/10">
            <AlertCircle className="size-6 text-destructive" />
          </div>
          <h2 className="text-lg font-medium">No agent specified</h2>
          <p className="text-muted-foreground">
            Please select an agent to edit from the agents list.
          </p>
          <Button onClick={() => router.push('/agents')}>
            Back to Agents
          </Button>
        </div>
      </div>
    );
  }

  return (
    <FlowProvider>
      <AgentEditorProvider agentId={agentId}>
        <AgentEditorContent />
      </AgentEditorProvider>
    </FlowProvider>
  );
}
