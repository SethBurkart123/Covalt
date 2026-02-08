/**
 * Agent Node
 * An LLM-powered agent that can use tools and act as a sub-agent.
 */

import type { NodeDefinition } from '../../_types';

export const agent = {
  id: 'agent',
  name: 'Agent',
  description: 'An LLM-powered agent that can use tools',
  category: 'core',
  icon: 'Bot',
  
  parameters: [
    {
      id: 'agent',
      type: 'agent',
      label: 'Agent',
      mode: 'input',
      socket: { type: 'agent', bidirectional: true },
    },
    {
      id: 'tools',
      type: 'tools',
      label: 'Tools',
      mode: 'input',
      multiple: true,
      socket: { type: 'tools', side: 'right' },
      acceptsTypes: ['tools', 'agent'],
    },
    {
      id: 'model',
      type: 'model',
      label: 'Model',
      mode: 'constant',
    },
    {
      id: 'name',
      type: 'string',
      label: 'Name',
      mode: 'constant',
      default: '',
      placeholder: 'Agent name',
    },
    {
      id: 'description',
      type: 'text-area',
      label: 'Description',
      mode: 'constant',
      default: '',
      placeholder: 'What does this agent do?',
      rows: 2,
    },
    {
      id: 'instructions',
      type: 'text-area',
      label: 'Instructions',
      mode: 'constant',
      default: '',
      placeholder: 'System prompt / personality',
      rows: 4,
    },
  ],
} as const satisfies NodeDefinition;

export default agent;
