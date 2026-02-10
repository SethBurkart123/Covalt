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
  executionMode: 'flow',

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
      id: 'input',
      type: 'data',
      label: 'Data',
      mode: 'input',
      socket: { type: 'data' },
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

export default promptTemplate;
