/**
 * Agent Node
 * An LLM-powered agent that can use tools and act as a sub-agent.
 */

import type { NodeDefinition } from '../../_types';

export const agent = {
  id: 'agent',
  name: 'Agent',
  description: 'An LLM-powered agent that can use tools',
  category: 'llm',
  icon: 'Bot',
  executionMode: 'hybrid',

  parameters: [
    {
      id: 'tools',
      type: 'tools',
      label: 'Tools',
      mode: 'input',
      multiple: true,
      socket: { type: 'tools', side: 'right', channel: 'link' },
      acceptsTypes: ['tools', 'data'],
    },
    {
      id: 'input',
      type: 'data',
      label: 'Data',
      mode: 'input',
      socket: { type: 'data', bidirectional: true },
    },
    {
      id: 'output',
      type: 'data',
      label: 'Data',
      mode: 'output',
      socket: { type: 'data' },
    },
    // Config
    {
      id: 'model',
      type: 'model',
      label: 'Model',
      mode: 'hybrid',
      socket: { type: 'model', side: 'left' },
    },
    {
      id: 'messages',
      type: 'messages',
      label: 'Messages',
      mode: 'constant',
      default: {
        mode: 'expression',
        expression: '{{ $input.messages }}',
      },
    },
    {
      id: 'instructions',
      type: 'text-area',
      label: 'Instructions',
      mode: 'hybrid',
      default: '',
      placeholder: 'System prompt / personality',
      rows: 4,
      socket: { type: 'string', side: 'left' },
    },
    {
      id: 'temperature',
      type: 'float',
      label: 'Temperature',
      mode: 'hybrid',
      default: 0.7,
      min: 0,
      max: 2,
      step: 0.1,
      socket: { type: 'float', side: 'left' },
    },
    // Sub-agent identity
    {
      id: 'name',
      type: 'string',
      label: 'Name',
      mode: 'constant',
      default: '',
      placeholder: 'Agent name',
      showWhen: {
        connectedTo: 'tools',
        channel: 'link',
      },
    },
    {
      id: 'description',
      type: 'text-area',
      label: 'Description',
      mode: 'constant',
      default: '',
      placeholder: 'What does this agent do?',
      rows: 2,
      showWhen: {
        connectedTo: 'tools',
        channel: 'link',
      },
    },
  ],
} as const satisfies NodeDefinition;

export default agent;
