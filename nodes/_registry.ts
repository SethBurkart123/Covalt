import type { NodeDefinition, FlowNode, SocketTypeId, Parameter } from './_types';
import { canConnect, canCoerce } from '@/lib/flow/sockets';
import {
  getNodeDefinition as getRegisteredNodeDefinition,
  getNodeDefinitionMetadata as getRegisteredNodeDefinitionMetadata,
  listAllNodeDefinitions as listRegisteredNodeDefinitions,
  listNodeTypes as listRegisteredNodeTypes,
  registerPlugin,
  type NodeDefinitionMetadata,
} from '@/lib/flow/plugin-registry';

import { builtinPluginManifest } from './manifest';


interface CompatibleNodeSocket {
  nodeId: string;
  nodeName: string;
  nodeIcon: string;
  nodeCategory: NodeDefinition['category'];
  socketId: string;
  socketLabel: string;
  socketType: SocketTypeId;
}

function ensureBuiltinPluginRegistered(): void {
  try {
    registerPlugin(builtinPluginManifest);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('already registered')) {
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

