import { describe, it, expect } from 'vitest';
import type { FlowEdge, FlowNode } from '@/lib/flow';
import { downstreamClosure } from '../graph-traversal';
import { buildCachedOutputs, computeRunPlan } from '../use-flow-runner';

const edges: FlowEdge[] = [
  {
    id: 'e1',
    source: 'a',
    sourceHandle: 'output',
    target: 'b',
    targetHandle: 'input',
    data: { channel: 'flow' },
  },
  {
    id: 'e2',
    source: 'b',
    sourceHandle: 'output',
    target: 'c',
    targetHandle: 'input',
    data: { channel: 'flow' },
  },
];

describe('execution cache helpers', () => {
  it('invalidates downstream nodes when upstream changes', () => {
    const invalidated = downstreamClosure(['a'], edges, { stopAt: new Set() });
    expect(Array.from(invalidated).sort()).toEqual(['a', 'b', 'c']);
  });

  it('stops invalidation at pinned nodes', () => {
    const invalidated = downstreamClosure(['a'], edges, { stopAt: new Set(['b']) });
    expect(Array.from(invalidated).sort()).toEqual(['a']);
  });

  it('omits nodes scheduled to re-run from cached outputs', () => {
    const cached = buildCachedOutputs(
      {
        a: { outputs: { output: { type: 'string', value: 'hello' } } },
        b: { outputs: { output: { type: 'string', value: 'world' } } },
      },
      new Set(['a'])
    );
    expect(Object.keys(cached).sort()).toEqual(['a']);
  });

  it('limits cached trigger outputs to the selected trigger', () => {
    const triggerEdges: FlowEdge[] = [
      {
        id: 't1',
        source: 'cs',
        sourceHandle: 'output',
        target: 'agent',
        targetHandle: 'input',
        data: { channel: 'flow' },
      },
      {
        id: 't2',
        source: 'wh',
        sourceHandle: 'output',
        target: 'agent',
        targetHandle: 'input',
        data: { channel: 'flow' },
      },
    ];

    const nodes: FlowNode[] = [
      { id: 'cs', type: 'chat-start', position: { x: 0, y: 0 }, data: {} },
      { id: 'wh', type: 'webhook-trigger', position: { x: 0, y: 0 }, data: {} },
      { id: 'agent', type: 'agent', position: { x: 0, y: 0 }, data: {} },
    ];

    const plan = computeRunPlan(
      'execute',
      'agent',
      nodes,
      triggerEdges,
      new Set(),
      {
        cs: { outputs: { output: { type: 'string', value: 'hello' } } },
        wh: { outputs: { output: { type: 'string', value: 'world' } } },
      },
      'cs'
    );

    expect(Array.from(plan.excludedTriggerIds)).toEqual(['wh']);
    expect(Array.from(plan.cachedNodeIds)).toEqual(['cs']);
  });
});
