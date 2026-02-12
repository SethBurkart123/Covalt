'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Loader2, AlertCircle } from 'lucide-react';
import { FlowProvider } from '@/lib/flow';
import { FlowCanvas, NodeInspectorDialog } from '@/components/flow';
import { AgentEditorProvider, useAgentEditor } from '@/contexts/agent-editor-context';
import { AgentTestChatProvider, useAgentTestChat } from '@/contexts/agent-test-chat-context';
import { usePageTitle } from '@/contexts/page-title-context';
import { AgentEditorHeaderLeft, AgentEditorHeaderRight } from './AgentEditorHeader';
import { AgentTestChatPanel } from './AgentTestChatPanel';
import { AgentSettingsDialog } from './AgentSettingsDialog';
import { Button } from '@/components/ui/button';
import { useCanvasPreview } from '@/hooks/use-canvas-preview';

function AgentEditorContent() {
  const router = useRouter();
  const { setLeftContent, setRightContent, setFloating } = usePageTitle();
  const { agentId, isLoading, loadError, agent, saveStatus, updateMetadata } = useAgentEditor();
  const { isOpen: isChatOpen, toggle: toggleChat, lastExecutionByNode } = useAgentTestChat();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorNodeId, setInspectorNodeId] = useState<string | null>(null);
  const { captureAndUpload } = useCanvasPreview(agentId);
  const captureRef = useRef(captureAndUpload);

  const handleNodeDoubleClick = (nodeId: string) => {
    setInspectorNodeId(nodeId);
    setInspectorOpen(true);
  };

  useEffect(() => {
    setFloating(true);
    return () => setFloating(false);
  }, [setFloating]);

  useEffect(() => {
    if (!agent) return;
    const handleUpdateName = (name: string) => updateMetadata({ name });
    setLeftContent(
      <AgentEditorHeaderLeft agentName={agent.name} onUpdateName={handleUpdateName} />
    );
    setRightContent(
      <AgentEditorHeaderRight
        saveStatus={saveStatus}
        onOpenSettings={() => setSettingsOpen(true)}
        onToggleChat={toggleChat}
        isChatOpen={isChatOpen}
      />
    );
    return () => {
      setLeftContent(null);
      setRightContent(null);
    };
  }, [agent, saveStatus, updateMetadata, setLeftContent, setRightContent, toggleChat, isChatOpen]);

  useEffect(() => {
    captureRef.current = captureAndUpload;
  }, [captureAndUpload]);

  useEffect(() => {
    if (!agent || isLoading) return;
    const timer = setTimeout(() => captureAndUpload(), 800);
    return () => clearTimeout(timer);
  }, [agent, isLoading, captureAndUpload]);

  useEffect(() => {
    return () => {
      captureRef.current();
    };
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Loading agent...</p>
        </div>
      </div>
    );
  }

  if (loadError || !agent) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
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
    <div className="flex flex-row flex-1 min-h-0">
      <div className="flex flex-col flex-1 min-h-0 min-w-0">
        <div className="flex-1 relative min-h-0">
          <FlowCanvas onNodeDoubleClick={handleNodeDoubleClick} />
          <NodeInspectorDialog
            open={inspectorOpen}
            onOpenChange={setInspectorOpen}
            nodeId={inspectorNodeId}
            lastExecutionByNode={lastExecutionByNode}
          />
        </div>
        <AgentSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      </div>
      <AgentTestChatPanel />
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
    <AgentTestChatProvider>
      <FlowProvider>
        <AgentEditorProvider agentId={agentId}>
          <AgentEditorContent />
        </AgentEditorProvider>
      </FlowProvider>
    </AgentTestChatProvider>
  );
}
