import { describe, expect, it } from 'vitest';

import { buildNodeTypes } from '../node-types';

describe('buildNodeTypes', () => {
  it('maps generic node types to the same renderer reference', () => {
    const result = buildNodeTypes(['alpha', 'beta', 'gamma']);

    expect(result.alpha).toBeDefined();
    expect(result.alpha).toBe(result.beta);
    expect(result.beta).toBe(result.gamma);
  });

  it('uses a custom component for reroute', () => {
    const result = buildNodeTypes(['alpha', 'reroute']);

    expect(result.reroute).toBeDefined();
    expect(result.reroute).not.toBe(result.alpha);
  });

  it('returns deterministically sorted node type keys', () => {
    const result = buildNodeTypes(['gamma', 'alpha', 'beta']);
    expect(Object.keys(result)).toEqual(['alpha', 'beta', 'gamma']);
  });
});
