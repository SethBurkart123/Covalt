/**
 * Reroute Node
 * Organize node graphs by routing a socket through a small pass-through node.
 */

import type { NodeDefinition } from '../../_types';

const ACCEPTS_ALL = [
  'data',
  'tools',
  'float',
  'int',
  'string',
  'boolean',
  'json',
  'model',
] as const;

export const reroute = {
  id: 'reroute',
  name: 'Reroute',
  description: 'Organize node graphs by rerouting a connection',
  category: 'utility',
  icon: 'Dot',
  executionMode: 'flow',

  parameters: [
    {
      id: 'input',
      type: 'data',
      label: 'Input',
      mode: 'input',
      socket: { type: 'data' },
      acceptsTypes: ACCEPTS_ALL,
    },
    {
      id: 'output',
      type: 'data',
      label: 'Output',
      mode: 'output',
      socket: { type: 'data' },
    },
    {
      id: 'value',
      type: 'json',
      label: 'Default Value',
      mode: 'constant',
      default: null,
      renderScope: 'inspector',
      showWhen: {
        notConnected: 'input',
      },
    },
  ],
} as const satisfies NodeDefinition;

export default reroute;
