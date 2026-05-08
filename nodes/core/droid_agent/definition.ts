/**
 * Droid Agent Node
 * Runs Factory Droid (https://factory.ai) as an autonomous coding agent via
 * the local `droid` CLI. All runtime config (cwd, model, autonomy, reasoning,
 * mode) is contributed via declare_variables and surfaced in the chat composer.
 */

import type { NodeDefinition } from '../../_types';

export const droidAgent = {
  id: 'droid-agent',
  name: 'Droid Agent',
  description: 'Run Factory Droid as an autonomous coding agent',
  category: 'llm',
  icon: 'Hammer',
  executionMode: 'flow',

  parameters: [
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
    {
      id: 'name',
      type: 'string',
      label: 'Name',
      mode: 'constant',
      default: 'Droid',
      placeholder: 'Agent name',
    },
  ],
} as const satisfies NodeDefinition;
