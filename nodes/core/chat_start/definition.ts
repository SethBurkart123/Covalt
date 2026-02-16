/**
 * Chat Start Node
 * Entry point for user messages. Connects to an Agent node.
 */

import type { NodeDefinition } from '../../_types';

export const chatStart = {
  id: 'chat-start',
  name: 'Chat Start',
  description: 'Entry point where user messages enter the graph',
  category: 'trigger',
  icon: 'MessageSquare',
  executionMode: 'hybrid',

  parameters: [
    {
      id: 'output',
      type: 'data',
      label: 'Data',
      mode: 'output',
      socket: { type: 'data' },
    },
    {
      id: 'primaryAgentId',
      type: 'node-ref',
      label: 'Primary Agent',
      mode: 'constant',
      nodeTypes: ['agent'],
      placeholder: 'Select an agent...',
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
