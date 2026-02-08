/**
 * Chat Start Node
 * Entry point for user messages. Connects to an Agent node.
 */

import type { NodeDefinition } from '../../_types';

export const chatStart = {
  id: 'chat-start',
  name: 'Chat Start',
  description: 'Entry point where user messages enter the graph',
  category: 'core',
  icon: 'MessageSquare',
  
  parameters: [
    {
      id: 'agent',
      type: 'agent',
      label: 'Agent',
      mode: 'output',
      socket: { type: 'agent' },
      maxConnections: 1,
      onExceedMax: 'replace',
    },
    {
      id: 'includeUserTools',
      type: 'boolean',
      label: 'Include User Tools',
      mode: 'constant',
      default: false,
    },
  ],
} as const satisfies NodeDefinition;

export default chatStart;
