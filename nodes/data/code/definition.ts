/**
 * Code Node
 * Execute custom JavaScript to transform incoming data.
 */

import type { NodeDefinition } from '../../_types';

export const code = {
  id: 'code',
  name: 'Code',
  description: 'Run custom JavaScript to transform data',
  category: 'data',
  icon: 'Code',
  executionMode: 'flow',

  parameters: [
    {
      id: 'code',
      type: 'code',
      label: 'JavaScript',
      mode: 'constant',
      renderScope: 'inspector',
      panelLayout: 'full',
      default: 'return $input;',
      placeholder: "return { result: $input.value };",
      rows: 8,
      language: 'javascript',
    },
    {
      id: 'input',
      type: 'data',
      label: 'Input',
      mode: 'input',
      socket: { type: 'data' },
    },
    {
      id: 'output',
      type: 'data',
      label: 'Output',
      mode: 'output',
      socket: { type: 'data' },
    },
  ],
} as const satisfies NodeDefinition;

export default code;
