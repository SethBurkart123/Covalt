import type { NodeDefinition, FlowNode, SocketTypeId, Parameter } from './_types';
import type { NodeEntry, PluginManifest } from './_manifest';
import { canConnect, canCoerce } from '@/lib/flow/sockets';
import {
  clearDynamicNodeDefinitions as clearDynamicDefinitions,
  getNodeDefinition as getRegisteredNodeDefinition,
  getNodeDefinitionMetadata as getRegisteredNodeDefinitionMetadata,
  listAllNodeDefinitions as listRegisteredNodeDefinitions,
  listNodeDefinitionMetadata as listRegisteredNodeDefinitionMetadata,
  listNodeTypes as listRegisteredNodeTypes,
  registerPlugin,
  setDynamicNodeDefinitions as setDynamicDefinitions,
  type NodeDefinitionMetadata,
} from '@/lib/flow/plugin-registry';

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

export interface CompatibleNodeSocket {
  nodeId: string;
  nodeName: string;
  nodeIcon: string;
  nodeCategory: NodeDefinition['category'];
  socketId: string;
  socketLabel: string;
  socketType: SocketTypeId;
}

const BUILTIN_DEFINITIONS: readonly NodeDefinition[] = [
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
];

const BUILTIN_NODE_ENTRIES: readonly NodeEntry[] = [
  {
    type: 'chat-start',
    definitionPath: 'nodes/core/chat_start/definition.ts',
    executorPath: 'nodes/core/chat_start/executor.py',
  },
  {
    type: 'webhook-trigger',
    definitionPath: 'nodes/core/webhook_trigger/definition.ts',
    executorPath: 'nodes/core/webhook_trigger/executor.py',
  },
  {
    type: 'webhook-end',
    definitionPath: 'nodes/core/webhook_end/definition.ts',
    executorPath: 'nodes/core/webhook_end/executor.py',
  },
  {
    type: 'agent',
    definitionPath: 'nodes/core/agent/definition.ts',
    executorPath: 'nodes/core/agent/executor.py',
  },
  {
    type: 'mcp-server',
    definitionPath: 'nodes/tools/mcp_server/definition.ts',
    executorPath: 'nodes/tools/mcp_server/executor.py',
  },
  {
    type: 'toolset',
    definitionPath: 'nodes/tools/toolset/definition.ts',
    executorPath: 'nodes/tools/toolset/executor.py',
  },
  {
    type: 'llm-completion',
    definitionPath: 'nodes/ai/llm_completion/definition.ts',
    executorPath: 'nodes/ai/llm_completion/executor.py',
  },
  {
    type: 'conditional',
    definitionPath: 'nodes/flow/conditional/definition.ts',
    executorPath: 'nodes/flow/conditional/executor.py',
  },
  {
    type: 'merge',
    definitionPath: 'nodes/flow/merge/definition.ts',
    executorPath: 'nodes/flow/merge/executor.py',
  },
  {
    type: 'reroute',
    definitionPath: 'nodes/flow/reroute/definition.ts',
    executorPath: 'nodes/flow/reroute/executor.py',
  },
  {
    type: 'code',
    definitionPath: 'nodes/data/code/definition.ts',
    executorPath: 'nodes/data/code/executor.py',
  },
  {
    type: 'model-selector',
    definitionPath: 'nodes/utility/model_selector/definition.ts',
    executorPath: 'nodes/utility/model_selector/executor.py',
  },
];

const BUILTIN_PLUGIN_MANIFEST: PluginManifest = {
  id: 'builtin',
  name: 'Built-in Nodes',
  version: '0.1.0',
  nodes: BUILTIN_NODE_ENTRIES,
  definitions: BUILTIN_DEFINITIONS,
};

function ensureBuiltinPluginRegistered(): void {
  try {
    registerPlugin(BUILTIN_PLUGIN_MANIFEST);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("already registered")) {
      throw error;
    }
  }
}

ensureBuiltinPluginRegistered();

export function getNodeDefinition(id: string): NodeDefinition | undefined {
  return getRegisteredNodeDefinition(id);
}

export const NODE_DEFINITIONS: Record<string, NodeDefinition> = new Proxy(
  {} as Record<string, NodeDefinition>,
  {
    get: (_target, property) =>
      typeof property === 'string' ? getNodeDefinition(property) : undefined,
    has: (_target, property) =>
      typeof property === 'string' ? getNodeDefinition(property) !== undefined : false,
    ownKeys: () => listNodeTypes(),
    getOwnPropertyDescriptor: (_target, property) => {
      if (typeof property !== 'string') {
        return undefined;
      }

      const definition = getNodeDefinition(property);
      if (!definition) {
        return undefined;
      }

      return {
        enumerable: true,
        configurable: true,
        value: definition,
        writable: false,
      };
    },
  }
);

function generateNodeId(type: string): string {
  return `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function buildDefaultData(definition: NodeDefinition): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const param of definition.parameters) {
    if ('default' in param && param.default !== undefined) {
      data[param.id] = param.default;
    }
  }
  return data;
}

export function createFlowNode(
  type: string,
  position: { x: number; y: number },
  id?: string
): FlowNode {
  const definition = getNodeDefinition(type);
  if (!definition) {
    throw new Error(`Unknown node type: ${type}`);
  }

  return {
    id: id ?? generateNodeId(type),
    type,
    position,
    data: buildDefaultData(definition),
  };
}

export function listAllNodeDefinitions(): NodeDefinition[] {
  return listRegisteredNodeDefinitions();
}

export function getNodeDefinitionMetadata(id: string): NodeDefinitionMetadata | undefined {
  return getRegisteredNodeDefinitionMetadata(id);
}

export function listNodeTypes(): string[] {
  return listRegisteredNodeTypes();
}

export function listNodeDefinitionMetadata(): NodeDefinitionMetadata[] {
  return listRegisteredNodeDefinitionMetadata();
}

export function getNodesByCategory(category: NodeDefinition['category']): NodeDefinition[] {
  return listAllNodeDefinitions().filter((node) => node.category === category);
}

export function getCompatibleNodeSockets(
  sourceType: SocketTypeId,
  needsInput: boolean
): CompatibleNodeSocket[] {
  const results: CompatibleNodeSocket[] = [];

  for (const node of listAllNodeDefinitions()) {
    for (const param of node.parameters) {
      const candidate = param as Parameter;
      if (!candidate.socket) continue;

      const isInput = candidate.mode === 'input' || candidate.mode === 'hybrid';
      const isOutput = candidate.mode === 'output';
      if (needsInput && !isInput) continue;
      if (!needsInput && !isOutput) continue;

      if (needsInput) {
        if (!canConnect(sourceType, candidate)) continue;
      } else if (!canCoerce(candidate.socket.type, sourceType)) {
        continue;
      }

      results.push({
        nodeId: node.id,
        nodeName: node.name,
        nodeIcon: node.icon,
        nodeCategory: node.category,
        socketId: candidate.id,
        socketLabel: candidate.label,
        socketType: candidate.socket.type,
      });
    }
  }

  return results;
}

export function setDynamicNodeDefinitions(definitions: readonly NodeDefinition[]): void {
  setDynamicDefinitions(definitions);
}

export function clearDynamicNodeDefinitions(): void {
  clearDynamicDefinitions();
}

export { chatStart, webhookTrigger, webhookEnd, agent, mcpServer, toolset };
