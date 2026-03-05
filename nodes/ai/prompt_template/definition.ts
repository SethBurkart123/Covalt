/**
 * Prompt Template Node
 * Renders a template string with values from incoming data.
 */

import type { NodeDefinition } from '../../_types';

export const promptTemplate = {
  id: 'prompt-template',
  name: 'Prompt Template',
  description: 'Render a prompt template from incoming data',
  category: 'llm',
  icon: 'TextQuote',
  executionMode: 'flow',

  parameters: [
    {
      id: 'input',
      type: 'data',
      label: 'Data',
      mode: 'input',
      socket: { type: 'data' },
    },
    {
      id: 'template',
      type: 'text-area',
      label: 'Template',
      mode: 'hybrid',
      default: '{{message}}',
      rows: 4,
      placeholder: 'Write a template, e.g. {{message}}',
      socket: { type: 'string', side: 'left' },
    },
    {
      id: 'output',
      type: 'data',
      label: 'Data',
      mode: 'output',
      socket: { type: 'data' },
    },
  ],
} as const satisfies NodeDefinition;
