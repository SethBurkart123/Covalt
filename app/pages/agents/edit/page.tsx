import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Loader2, AlertCircle } from 'lucide-react';
import { FlowProvider } from '@/lib/flow';
import { FlowCanvas, NodeInspectorDialog } from '@/components/flow';
import { AgentEditorProvider, useAgentEditor } from '@/contexts/agent-editor-context';
import { AgentTestChatProvider, useAgentTestChat } from '@/contexts/agent-test-chat-context';
import { FlowExecutionProvider } from '@/contexts/flow-execution-context';
import { FlowRunnerProvider } from '@/lib/flow/use-flow-runner';
import { usePageTitle } from '@/contexts/page-title-context';
import { AgentEditorHeaderLeft, AgentEditorHeaderRight } from './AgentEditorHeader';
import { AgentTestChatPanel } from './AgentTestChatPanel';
import { AgentSettingsDialog } from './AgentSettingsDialog';
import { Button } from '@/components/ui/button';
import { useCanvasPreview } from '@/hooks/use-canvas-preview';

function AgentEditorContent() {
  const navigate = useNavigate();
  const { setLeftContent, setRightContent, setFloating } = usePageTitle();
  const { agentId, isLoading, loadError, agent, saveStatus, updateMetadata, lastSaved } = useAgentEditor();
  const { isOpen: isChatOpen, toggle: toggleChat } = useAgentTestChat();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorNodeId, setInspectorNodeId] = useState<string | null>(null);
  const { captureAndUpload } = useCanvasPreview({
    agentId,
    lastSaved,
    previewImage: agent?.previewImage ?? null,
  });
  const hasEditedGraphRef = useRef(false);

  const handleNodeDoubleClick = (nodeId: string) => {
    setInspectorNodeId(nodeId);
    setInspectorOpen(true);
  };

  useEffect(() => {
    setFloating(true);
    return () => setFloating(false);
  }, [setFloating]);

  // TODO: consider removing this Effect — storing JSX in state via Effect (anti-pattern 9).
  // The page-title context API currently expects ReactNode to be set imperatively.
  // Refactoring this requires changing the context API to accept component props instead.
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

  if (saveStatus === 'dirty') {
    hasEditedGraphRef.current = true;
  }

  useEffect(() => {
    if (isLoading || saveStatus !== 'saved' || !hasEditedGraphRef.current) return;
    hasEditedGraphRef.current = false;
    const timer = setTimeout(() => captureAndUpload(), 800);
    return () => clearTimeout(timer);
  }, [isLoading, saveStatus, captureAndUpload]);

  useEffect(() => {
    if (isLoading || !agent) return;
    const timer = setTimeout(() => captureAndUpload(), 800);
    return () => clearTimeout(timer);
  }, [isLoading, agent, captureAndUpload]);

  if (isLoading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Loading agent...</p>
        </div>
      </div>
    );
  }

  if (loadError || !agent) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center max-w-md">
          <div className="flex items-center justify-center size-12 rounded-full bg-destructive/10">
            <AlertCircle className="size-6 text-destructive" />
          </div>
          <h2 className="text-lg font-medium">Agent not found</h2>
          <p className="text-muted-foreground">
            {loadError || "The agent you're looking for doesn't exist or has been deleted."}
          </p>
          <Button onClick={() => navigate({ to: '/agents' })}>
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
          />
        </div>
        <AgentSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      </div>
      <AgentTestChatPanel />
    </div>
  );
}

function AgentEditorPageContent() {
  const search = useSearch({ from: '/_app/_pages/agents/edit' });
  const navigate = useNavigate();
  const agentId = search.id ?? null;

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
          <Button onClick={() => navigate({ to: '/agents' })}>
            Back to Agents
          </Button>
        </div>
      </div>
    );
  }

  return (
    <FlowProvider>
      <FlowExecutionProvider agentId={agentId}>
        <FlowRunnerProvider agentId={agentId}>
          <AgentTestChatProvider agentId={agentId}>
            <AgentEditorProvider agentId={agentId}>
              <AgentEditorContent />
            </AgentEditorProvider>
          </AgentTestChatProvider>
        </FlowRunnerProvider>
      </FlowExecutionProvider>
    </FlowProvider>
  );
}

export default function AgentEditorPage() {
  return <AgentEditorPageContent />;
}
