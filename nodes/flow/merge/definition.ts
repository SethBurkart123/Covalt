/**
 * Merge Node
 * Combine multiple inputs into a single array output.
 */

import type { NodeDefinition } from '../../_types';

export const merge = {
  id: 'merge',
  name: 'Merge',
  description: 'Combine multiple inputs into a single array',
  category: 'flow',
  icon: 'GitMerge',
  executionMode: 'flow',

  parameters: [
    {
      id: 'input',
      type: 'data',
      label: 'Input',
      mode: 'input',
      socket: { type: 'data' },
      autoExpand: { min: 2 },
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

export default merge;
