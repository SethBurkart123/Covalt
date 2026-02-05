/**
 * Node Registry
 * Auto-registers all node definitions for the flow system.
 */

import type { NodeDefinition, FlowNode, SocketTypeId, Parameter } from '../types';
import { canConnect } from '../sockets';

// Import all node definitions
import { chatStart } from './chat-start';
import { agent } from './agent';
import { mcpServer } from './mcp-server';
import { toolset } from './toolset';

/** All registered node definitions */
const NODE_LIST = [chatStart, agent, mcpServer, toolset] as const;

/** Node definitions by ID */
export const NODE_DEFINITIONS: Record<string, NodeDefinition> = Object.fromEntries(
  NODE_LIST.map(node => [node.id, node])
);

/** Get a node definition by ID */
export function getNodeDefinition(id: string): NodeDefinition | undefined {
  return NODE_DEFINITIONS[id];
}

/** List all registered node IDs */
export function listNodeTypes(): string[] {
  return Object.keys(NODE_DEFINITIONS);
}

/** List node definitions by category */
export function getNodesByCategory(category: NodeDefinition['category']): NodeDefinition[] {
  return NODE_LIST.filter(node => node.category === category);
}

/** Create a new flow node instance with default data */
export function createFlowNode(
  type: string,
  position: { x: number; y: number },
  id?: string
): FlowNode {
  const definition = NODE_DEFINITIONS[type];
  if (!definition) {
    throw new Error(`Unknown node type: ${type}`);
  }
  
  // Build default data from parameter definitions
  const data: Record<string, unknown> = {};
  for (const param of definition.parameters) {
    if ('default' in param && param.default !== undefined) {
      data[param.id] = param.default;
    }
  }
  
  return {
    id: id ?? `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    position,
    data,
  };
}

/** A node+socket pair that can be created from a connection */
export interface CompatibleNodeSocket {
  nodeId: string;
  nodeName: string;
  nodeIcon: string;
  nodeCategory: NodeDefinition['category'];
  socketId: string;
  socketLabel: string;
  socketType: SocketTypeId;
}

/**
 * Get all node+socket pairs compatible with a given socket type.
 * @param sourceType - The socket type being connected from
 * @param needsInput - If true, find nodes with INPUT sockets; if false, find nodes with OUTPUT sockets
 */
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
        // Reverse compatibility check: agent→tools is allowed
        if (p.socket.type !== sourceType && !(p.socket.type === 'agent' && sourceType === 'tools')) continue;
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

// Re-export individual nodes for direct import
export { chatStart, agent, mcpServer, toolset };
