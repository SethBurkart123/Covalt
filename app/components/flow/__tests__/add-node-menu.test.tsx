import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as ReactNamespace from 'react';
import type { NodeDefinition } from '@/lib/flow';
import { registerPlugin, unregisterPlugin } from '@/lib/flow';

(globalThis as { React?: typeof ReactNamespace }).React = ReactNamespace;

let memoCursor = 0;
const memoSlots: Array<{ deps: unknown[]; value: unknown }> = [];

function beginRender() {
  memoCursor = 0;
}

function shallowEqualDeps(prev: unknown[], next: unknown[]): boolean {
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    if (!Object.is(prev[i], next[i])) return false;
  }
  return true;
}

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');

  return {
    ...actual,
    useMemo: <T,>(factory: () => T, deps?: readonly unknown[]) => {
      const normalizedDeps = deps ? [...deps] : [];
      const slot = memoSlots[memoCursor];

      if (slot && shallowEqualDeps(slot.deps, normalizedDeps)) {
        memoCursor += 1;
        return slot.value as T;
      }

      const value = factory();
      memoSlots[memoCursor] = { deps: normalizedDeps, value };
      memoCursor += 1;
      return value;
    },
    useState: <T,>(initialState: T | (() => T)) => {
      const value = typeof initialState === 'function'
        ? (initialState as () => T)()
        : initialState;
      return [value, vi.fn()] as const;
    },
    useRef: <T,>(initialValue: T) => ({ current: initialValue }),
    useEffect: () => undefined,
    useCallback: <T extends (...args: never[]) => unknown>(callback: T) => callback,
  };
});

import { AddNodeMenu } from '../add-node-menu';

const TEST_PLUGIN_ID = 'external.dynamic';
const TEST_NODE_TYPE = `${TEST_PLUGIN_ID}:fresh-node`;

const TEST_DEFINITION: NodeDefinition = {
  id: TEST_NODE_TYPE,
  name: 'Fresh External Node',
  category: 'utility',
  icon: 'Sparkles',
  executionMode: 'flow',
  parameters: [],
};

function readFlatItemNodeIds(definitionsVersion: number): string[] {
  beginRender();

  (AddNodeMenu as unknown as (props: Record<string, unknown>) => unknown)({
    isOpen: true,
    onClose: () => undefined,
    position: { x: 0, y: 0 },
    onSelect: () => undefined,
    definitionsVersion,
  });

  const flatItems = memoSlots[2]?.value as Array<{ nodeId: string }> | undefined;
  return flatItems?.map((item) => item.nodeId) ?? [];
}

describe('AddNodeMenu definitions refresh', () => {
  beforeEach(() => {
    memoSlots.length = 0;
    memoCursor = 0;
    unregisterPlugin(TEST_PLUGIN_ID);
  });

  afterEach(() => {
    unregisterPlugin(TEST_PLUGIN_ID);
  });

  it('picks up newly registered definitions when definitionsVersion changes', () => {
    const initialNodeIds = readFlatItemNodeIds(0);
    expect(initialNodeIds).not.toContain(TEST_NODE_TYPE);

    registerPlugin({
      id: TEST_PLUGIN_ID,
      name: 'External Dynamic',
      version: '1.0.0',
      nodes: [
        {
          type: TEST_NODE_TYPE,
          definitionPath: 'definition.ts',
          executorPath: 'executor.py',
        },
      ],
      definitions: [TEST_DEFINITION],
    });

    const staleNodeIds = readFlatItemNodeIds(0);
    expect(staleNodeIds).not.toContain(TEST_NODE_TYPE);

    const refreshedNodeIds = readFlatItemNodeIds(1);
    expect(refreshedNodeIds).toContain(TEST_NODE_TYPE);
  });
});
