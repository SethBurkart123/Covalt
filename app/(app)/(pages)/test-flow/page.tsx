'use client';

import { useState, useCallback } from 'react';
import { FlowCanvas, PropertiesPanel } from '@/components/flow';
import { createFlowNode, type FlowNode, type FlowEdge } from '@/lib/flow';

// Create test nodes in hub topology layout:
// Chat Start → Agent (hub) ← MCP/Toolset/SubAgent
const initialNodes: FlowNode[] = [
  createFlowNode('chat-start', { x: 50, y: 200 }, 'chat-start-1'),
  createFlowNode('agent', { x: 350, y: 200 }, 'agent-1'),
  createFlowNode('mcp-server', { x: 700, y: 100 }, 'mcp-1'),
  createFlowNode('toolset', { x: 700, y: 250 }, 'toolset-1'),
  createFlowNode('agent', { x: 700, y: 400 }, 'agent-2'),
];

// Create some test edges with proper socket type data
// Tools connections should be yellow (tools) on both ends
// Agent connections should be purple (agent)
const initialEdges: FlowEdge[] = [
  { 
    id: 'e1', 
    source: 'chat-start-1', 
    sourceHandle: 'agent', 
    target: 'agent-1', 
    targetHandle: 'agent',
  },
  { 
    id: 'e2', 
    source: 'mcp-1', 
    sourceHandle: 'tools', 
    target: 'agent-1', 
    targetHandle: 'tools',
  },
  { 
    id: 'e3', 
    source: 'toolset-1', 
    sourceHandle: 'tools', 
    target: 'agent-1', 
    targetHandle: 'tools',
  },
  { 
    id: 'e4', 
    source: 'agent-2', 
    sourceHandle: 'agent', 
    target: 'agent-1', 
    targetHandle: 'tools',
  },
];

export default function TestFlowPage() {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [nodes, setNodes] = useState(initialNodes);
  
  // Find selected node
  const selectedNode = nodes.find(n => n.id === selectedNodeId);
  
  // Handle data changes from properties panel
  const handleDataChange = useCallback((paramId: string, value: unknown) => {
    if (!selectedNodeId) return;
    
    setNodes(prev => prev.map(node => 
      node.id === selectedNodeId 
        ? { ...node, data: { ...node.data, [paramId]: value } }
        : node
    ));
  }, [selectedNodeId]);

  return (
    <div className="h-screen relative">
      {/* Canvas - full width */}
      <FlowCanvas
        initialNodes={nodes}
        initialEdges={initialEdges}
        onNodeSelect={setSelectedNodeId}
      />
      
      {/* Floating Properties Panel - only visible when node selected */}
      {selectedNode && (
        <div className="absolute top-4 right-4 w-80">
          <PropertiesPanel
            nodeId={selectedNodeId}
            nodeType={selectedNode.type}
            nodeData={selectedNode.data}
            onDataChange={handleDataChange}
          />
        </div>
      )}
    </div>
  );
}
