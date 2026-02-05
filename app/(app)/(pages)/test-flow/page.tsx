'use client';

import { useEffect } from 'react';
import { FlowCanvas, PropertiesPanel } from '@/components/flow';
import { FlowProvider, useFlow, createFlowNode, type FlowNode, type FlowEdge } from '@/lib/flow';

// Test graph: Chat Start → Agent (hub) ← MCP/Toolset/SubAgent
const initialNodes: FlowNode[] = [
  createFlowNode('chat-start', { x: 50, y: 200 }, 'chat-start-1'),
  createFlowNode('agent', { x: 350, y: 200 }, 'agent-1'),
  createFlowNode('mcp-server', { x: 700, y: 100 }, 'mcp-1'),
  createFlowNode('toolset', { x: 700, y: 250 }, 'toolset-1'),
  createFlowNode('agent', { x: 700, y: 400 }, 'agent-2'),
];

const initialEdges: FlowEdge[] = [
  { id: 'e1', source: 'chat-start-1', sourceHandle: 'agent', target: 'agent-1', targetHandle: 'agent' },
  { id: 'e2', source: 'mcp-1', sourceHandle: 'tools', target: 'agent-1', targetHandle: 'tools' },
  { id: 'e3', source: 'toolset-1', sourceHandle: 'tools', target: 'agent-1', targetHandle: 'tools' },
  { id: 'e4', source: 'agent-2', sourceHandle: 'agent', target: 'agent-1', targetHandle: 'tools' },
];

function TestFlowContent() {
  const { loadGraph, selectedNodeId } = useFlow();

  useEffect(() => {
    loadGraph(initialNodes, initialEdges);
  }, [loadGraph]);

  return (
    <div className="h-screen relative">
      <FlowCanvas />

      {selectedNodeId && (
        <div className="absolute top-4 right-4 w-80">
          <PropertiesPanel />
        </div>
      )}
    </div>
  );
}

export default function TestFlowPage() {
  return (
    <FlowProvider>
      <TestFlowContent />
    </FlowProvider>
  );
}
