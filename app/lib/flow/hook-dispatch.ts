import type {
  NodeDefinition,
  OnNodeCreateContext,
  OnSocketTypePropagateContext,
  SocketTypeId,
} from '@nodes/_types';

import { dispatchHook } from './plugin-hooks';
import { SOCKET_TYPES } from './sockets';

function isSocketTypeId(value: string): value is SocketTypeId {
  return value in SOCKET_TYPES;
}

export function applyNodeCreateHooks(context: OnNodeCreateContext): Record<string, unknown> {
  const merged = { ...context.initialData };
  const patches = dispatchHook('onNodeCreate', context);

  for (const patch of patches) {
    if (patch && typeof patch === 'object') {
      Object.assign(merged, patch);
    }
  }

  return merged;
}

export function resolveSocketTypePropagation(
  context: OnSocketTypePropagateContext
): SocketTypeId | undefined {
  const results = dispatchHook('onSocketTypePropagate', context);

  for (let index = results.length - 1; index >= 0; index -= 1) {
    const value = results[index];
    if (typeof value === 'string' && isSocketTypeId(value)) {
      return value;
    }
  }

  return undefined;
}

export interface SocketTypePropagationConfig {
  stateField: string;
  inputHandle: string;
  outputHandle: string;
  supportsEdgeInsertion: boolean;
}

export function getSocketTypePropagationConfig(
  definition: NodeDefinition | undefined
): SocketTypePropagationConfig | null {
  const metadata = definition?.metadata?.socketTypePropagation;
  if (!metadata) {
    return null;
  }

  return {
    stateField:
      typeof metadata.stateField === 'string' && metadata.stateField.trim()
        ? metadata.stateField
        : '_socketType',
    inputHandle:
      typeof metadata.inputHandle === 'string' && metadata.inputHandle.trim()
        ? metadata.inputHandle
        : 'input',
    outputHandle:
      typeof metadata.outputHandle === 'string' && metadata.outputHandle.trim()
        ? metadata.outputHandle
        : 'output',
    supportsEdgeInsertion: Boolean(metadata.supportsEdgeInsertion),
  };
}
