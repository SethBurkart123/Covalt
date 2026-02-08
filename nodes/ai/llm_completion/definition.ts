/**
 * LLM Completion Node
 * Single LLM call — prompt in, streamed text out.
 */

import type { NodeDefinition } from '../../_types';

export const llmCompletion = {
  id: 'llm-completion',
  name: 'LLM Completion',
  description: 'Single LLM call with streaming output',
  category: 'ai',
  icon: 'Sparkles',
  executionMode: 'flow',

  parameters: [
    {
      id: 'model',
      type: 'model',
      label: 'Model',
      mode: 'constant',
    },
    {
      id: 'prompt',
      type: 'text-area',
      label: 'Prompt',
      mode: 'hybrid',
      default: '',
      placeholder: 'Enter prompt or connect input...',
      rows: 4,
      socket: { type: 'text', side: 'left' },
    },
    {
      id: 'temperature',
      type: 'float',
      label: 'Temperature',
      mode: 'constant',
      default: 0.7,
      min: 0,
      max: 2,
      step: 0.1,
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
      id: 'text',
      type: 'text-area',
      label: 'Output',
      mode: 'output',
      socket: { type: 'text' },
    },
  ],
} as const satisfies NodeDefinition;

export default llmCompletion;
