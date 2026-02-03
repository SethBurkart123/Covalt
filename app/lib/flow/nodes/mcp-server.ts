/**
 * MCP Server Node
 * Provides tools from a configured MCP server.
 */

import type { NodeDefinition } from '../types';

export const mcpServer = {
  id: 'mcp-server',
  name: 'MCP Server',
  description: 'Tools from an MCP server',
  category: 'tools',
  icon: 'Server',
  
  parameters: [
    // Config: which MCP server to use
    {
      id: 'server',
      type: 'mcp-server',
      label: 'Server',
      mode: 'constant',
    },
    
    // Output: tools provided by this server (left side for hub topology)
    {
      id: 'tools',
      type: 'tools',
      label: 'Tools',
      mode: 'output',
      socket: { type: 'tools', side: 'left' },
    },
  ],
} as const satisfies NodeDefinition;

export default mcpServer;
