/**
 * Webhook End Node
 * Terminates a webhook run and returns a response.
 */

import type { NodeDefinition } from '../../_types';

export const webhookEnd = {
  id: 'webhook-end',
  name: 'Webhook End',
  description: 'Return an HTTP response from a webhook run',
  category: 'flow',
  icon: 'CornerDownLeft',
  executionMode: 'flow',

  parameters: [
    {
      id: 'body',
      type: 'data',
      label: 'Body',
      mode: 'input',
      socket: { type: 'data' },
    },
    {
      id: 'status',
      type: 'int',
      label: 'Status',
      mode: 'constant',
      default: 200,
      min: 100,
      max: 599,
      step: 1,
      renderScope: 'inspector',
    },
    {
      id: 'headers',
      type: 'json',
      label: 'Headers',
      mode: 'constant',
      default: {},
      renderScope: 'inspector',
    },
    {
      id: 'response',
      type: 'data',
      label: 'Response',
      mode: 'output',
      socket: { type: 'data' },
      renderScope: 'inspector',
    },
  ],
} as const satisfies NodeDefinition;

export default webhookEnd;
