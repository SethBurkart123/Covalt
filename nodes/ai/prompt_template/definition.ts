/**
 * Prompt Template Node
 * Variable interpolation — renders {{variables}} from input data into a template.
 */

import type { NodeDefinition } from '../../_types';

export const promptTemplate = {
  id: 'prompt-template',
  name: 'Prompt Template',
  description: 'Interpolate variables into a template string',
  category: 'ai',
  icon: 'FileText',

  parameters: [
    {
      id: 'template',
      type: 'text-area',
      label: 'Template',
      mode: 'constant',
      default: '',
      placeholder: 'Hello, {{name}}! You are {{age}} years old.',
      rows: 6,
    },
    {
      id: 'data',
      type: 'json',
      label: 'Data',
      mode: 'input',
      socket: { type: 'json', side: 'left' },
    },
    {
      id: 'text',
      type: 'text-area',
      label: 'Output',
      mode: 'output',
      socket: { type: 'text' },
    },
  ],
} as const satisfies NodeDefinition;

export default promptTemplate;
