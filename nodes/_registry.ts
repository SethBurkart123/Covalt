import type { NodeDefinition, FlowNode, SocketTypeId, Parameter } from './_types';
import { canConnect, canCoerce } from '@/lib/flow/sockets';

import { chatStart } from './core/chat_start/definition';
import { webhookTrigger } from './core/webhook_trigger/definition';
import { webhookEnd } from './core/webhook_end/definition';
import { agent } from './core/agent/definition';
import { mcpServer } from './tools/mcp_server/definition';
import { toolset } from './tools/toolset/definition';
import { llmCompletion } from './ai/llm_completion/definition';
import { conditional } from './flow/conditional/definition';
import { merge } from './flow/merge/definition';
import { reroute } from './flow/reroute/definition';
import { code } from './data/code/definition';
import { modelSelector } from './utility/model_selector/definition';

const NODE_LIST = [
  chatStart,
  webhookTrigger,
  webhookEnd,
  agent,
  mcpServer,
  toolset,
  llmCompletion,
  conditional,
  merge,
  reroute,
  code,
  modelSelector,
] as const;

export interface NodeDefinitionMetadata {
  nodeType: string;
  definitionModule: string;
  runtimeModule: string;
}

const NODE_DEFINITION_METADATA: Record<string, NodeDefinitionMetadata> = {
  'chat-start': {
    nodeType: 'chat-start',
    definitionModule: 'nodes/core/chat_start/definition.ts',
    runtimeModule: 'nodes/core/chat_start/executor.py',
  },
  'webhook-trigger': {
    nodeType: 'webhook-trigger',
    definitionModule: 'nodes/core/webhook_trigger/definition.ts',
    runtimeModule: 'nodes/core/webhook_trigger/executor.py',
  },
  'webhook-end': {
    nodeType: 'webhook-end',
    definitionModule: 'nodes/core/webhook_end/definition.ts',
    runtimeModule: 'nodes/core/webhook_end/executor.py',
  },
  'agent': {
    nodeType: 'agent',
    definitionModule: 'nodes/core/agent/definition.ts',
    runtimeModule: 'nodes/core/agent/executor.py',
  },
  'mcp-server': {
    nodeType: 'mcp-server',
    definitionModule: 'nodes/tools/mcp_server/definition.ts',
    runtimeModule: 'nodes/tools/mcp_server/executor.py',
  },
  'toolset': {
    nodeType: 'toolset',
    definitionModule: 'nodes/tools/toolset/definition.ts',
    runtimeModule: 'nodes/tools/toolset/executor.py',
  },
  'llm-completion': {
    nodeType: 'llm-completion',
    definitionModule: 'nodes/ai/llm_completion/definition.ts',
    runtimeModule: 'nodes/ai/llm_completion/executor.py',
  },
  'conditional': {
    nodeType: 'conditional',
    definitionModule: 'nodes/flow/conditional/definition.ts',
    runtimeModule: 'nodes/flow/conditional/executor.py',
  },
  'merge': {
    nodeType: 'merge',
    definitionModule: 'nodes/flow/merge/definition.ts',
    runtimeModule: 'nodes/flow/merge/executor.py',
  },
  'reroute': {
    nodeType: 'reroute',
    definitionModule: 'nodes/flow/reroute/definition.ts',
    runtimeModule: 'nodes/flow/reroute/executor.py',
  },
  'code': {
    nodeType: 'code',
    definitionModule: 'nodes/data/code/definition.ts',
    runtimeModule: 'nodes/data/code/executor.py',
  },
  'model-selector': {
    nodeType: 'model-selector',
    definitionModule: 'nodes/utility/model_selector/definition.ts',
    runtimeModule: 'nodes/utility/model_selector/executor.py',
  },
};

export const NODE_DEFINITIONS: Record<string, NodeDefinition> = Object.fromEntries(
  NODE_LIST.map(node => [node.id, node])
);

export function getNodeDefinition(id: string): NodeDefinition | undefined {
  return NODE_DEFINITIONS[id];
}

export function getNodeDefinitionMetadata(id: string): NodeDefinitionMetadata | undefined {
  return NODE_DEFINITION_METADATA[id];
}

export function listNodeTypes(): string[] {
  return Object.keys(NODE_DEFINITIONS);
}

export function listNodeDefinitionMetadata(): NodeDefinitionMetadata[] {
  return Object.values(NODE_DEFINITION_METADATA);
}

export function getNodesByCategory(category: NodeDefinition['category']): NodeDefinition[] {
  return NODE_LIST.filter(node => node.category === category);
}

export function createFlowNode(
  type: string,
  position: { x: number; y: number },
  id?: string
): FlowNode {
  const definition = NODE_DEFINITIONS[type];
  if (!definition) {
    throw new Error(`Unknown node type: ${type}`);
  }
  
  const data: Record<string, unknown> = {};
  for (const param of definition.parameters) {
    if ('default' in param && param.default !== undefined) {
      data[param.id] = param.default;
    }
  }

  if (type === 'webhook-trigger') {
    const hookId = typeof data.hookId === 'string' ? data.hookId.trim() : '';
    if (!hookId) {
      data.hookId = `hook_${Math.random().toString(36).slice(2, 10)}`;
    }
  }
  
  return {
    id: id ?? `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    position,
    data,
  };
}

export interface CompatibleNodeSocket {
  nodeId: string;
  nodeName: string;
  nodeIcon: string;
  nodeCategory: NodeDefinition['category'];
  socketId: string;
  socketLabel: string;
  socketType: SocketTypeId;
}

export function getCompatibleNodeSockets(
  sourceType: SocketTypeId,
  needsInput: boolean
): CompatibleNodeSocket[] {
  const results: CompatibleNodeSocket[] = [];

  for (const node of NODE_LIST) {
    for (const param of node.parameters) {
      const p = param as Parameter;
      if (!p.socket) continue;

      const isInput = p.mode === 'input' || p.mode === 'hybrid';
      const isOutput = p.mode === 'output';
      if (needsInput && !isInput) continue;
      if (!needsInput && !isOutput) continue;

      if (needsInput) {
        if (!canConnect(sourceType, p)) continue;
      } else {
        // Reverse: we're dragging FROM an input, looking for compatible outputs.
        // The output's type must be connectable to the input's type.
        if (!canCoerce(p.socket.type, sourceType)) continue;
      }

      results.push({
        nodeId: node.id,
        nodeName: node.name,
        nodeIcon: node.icon,
        nodeCategory: node.category,
        socketId: p.id,
        socketLabel: p.label,
        socketType: p.socket.type,
      });
    }
  }

  return results;
}

export { chatStart, webhookTrigger, webhookEnd, agent, mcpServer, toolset };
