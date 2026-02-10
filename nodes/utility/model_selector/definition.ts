/**
 * Model Selector Node
 * Outputs a model socket value. Fan one model selection out to many Agent/LLM nodes.
 */

import type { NodeDefinition } from '../../_types';

export const modelSelector = {
  id: 'model-selector',
  name: 'Model',
  description: 'Select a model and fan it out to multiple nodes',
  category: 'utility',
  icon: 'Cpu',
  executionMode: 'flow',

  parameters: [
    {
      id: 'model',
      type: 'model',
      label: 'Model',
      mode: 'constant',
      socket: { type: 'model', side: 'left' },
    },
    {
      id: 'output',
      type: 'model',
      label: 'Model',
      mode: 'output',
      socket: { type: 'model' },
    },
  ],
} as const satisfies NodeDefinition;

export default modelSelector;
