/**
 * Conditional Node
 * Evaluates a condition and routes data to true or false output port.
 */

import type { NodeDefinition } from '../../_types';

export const conditional = {
  id: 'conditional',
  name: 'Conditional',
  description: 'Route data based on a condition',
  category: 'flow',
  icon: 'GitBranch',
  executionMode: 'flow',

  parameters: [
    {
      id: 'input',
      type: 'data',
      label: 'Input',
      mode: 'input',
      socket: { type: 'data' },
    },
    {
      id: 'field',
      type: 'string',
      label: 'Field',
      mode: 'constant',
      default: '',
      placeholder: 'Field name to evaluate',
    },
    {
      id: 'operator',
      type: 'enum',
      label: 'Operator',
      mode: 'constant',
      values: ['equals', 'contains', 'greaterThan', 'lessThan', 'startsWith', 'endsWith', 'exists', 'isEmpty'],
      default: 'equals',
    },
    {
      id: 'value',
      type: 'string',
      label: 'Value',
      mode: 'constant',
      default: '',
      placeholder: 'Compare value',
    },
    {
      id: 'true',
      type: 'data',
      label: 'True',
      mode: 'output',
      socket: { type: 'data' },
    },
    {
      id: 'false',
      type: 'data',
      label: 'False',
      mode: 'output',
      socket: { type: 'data' },
    },
  ],
} as const satisfies NodeDefinition;

export default conditional;
