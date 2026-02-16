/**
 * Webhook Trigger Node
 * Entry point for HTTP webhooks.
 */

import type { NodeDefinition } from '../../_types';

export const webhookTrigger = {
  id: 'webhook-trigger',
  name: 'Webhook Trigger',
  description: 'Entry point for HTTP webhooks',
  category: 'trigger',
  icon: 'Webhook',
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
      id: 'hookId',
      type: 'string',
      label: 'Hook ID',
      mode: 'constant',
      default: '',
      placeholder: 'Auto-generated hook id',
      renderScope: 'inspector',
    },
    {
      id: 'secret',
      type: 'string',
      label: 'Secret',
      mode: 'constant',
      default: '',
      placeholder: 'Optional shared secret',
      renderScope: 'inspector',
    },
    {
      id: 'secretHeader',
      type: 'string',
      label: 'Secret Header',
      mode: 'constant',
      default: 'x-webhook-secret',
      placeholder: 'Header name for secret',
      renderScope: 'inspector',
    },
    {
      id: 'schema',
      type: 'json',
      label: 'Schema',
      mode: 'constant',
      default: {},
      renderScope: 'inspector',
    },
    {
      id: 'allowSse',
      type: 'boolean',
      label: 'Allow SSE',
      mode: 'constant',
      default: true,
      renderScope: 'inspector',
    },
  ],
} as const satisfies NodeDefinition;

export default webhookTrigger;
