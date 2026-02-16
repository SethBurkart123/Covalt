/**
 * LLM Completion Node
 * Single LLM call — prompt in, streamed text out.
 */

import type { NodeDefinition } from '../../_types';

export const llmCompletion = {
  id: 'llm-completion',
  name: 'LLM Completion',
  description: 'Single LLM call with streaming output',
  category: 'llm',
  icon: 'Sparkles',
  executionMode: 'flow',

  parameters: [
    {
      id: 'input',
      type: 'data',
      label: 'Data',
      mode: 'input',
      socket: { type: 'data' },
    },
    {
      id: 'model',
      type: 'model',
      label: 'Model',
      mode: 'hybrid',
      socket: { type: 'model', side: 'left' },
    },
    {
      id: 'prompt',
      type: 'text-area',
      label: 'Prompt',
      mode: 'hybrid',
      default: '',
      placeholder: 'Enter prompt or connect input...',
      rows: 4,
      socket: { type: 'string', side: 'left' },
    },
    {
      id: 'temperature',
      type: 'float',
      label: 'Temperature',
      mode: 'hybrid',
      default: 0.7,
      min: 0,
      max: 2,
      step: 0.1,
      socket: { type: 'float', side: 'left' },
    },
    {
      id: 'max_tokens',
      type: 'int',
      label: 'Max Tokens',
      mode: 'constant',
      default: 1024,
      min: 1,
      max: 128000,
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

export default llmCompletion;
