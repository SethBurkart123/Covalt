import { describe, expect, it } from 'vitest';

import { buildNodeTypes } from '../node-types';

describe('buildNodeTypes', () => {
  it('maps every node type to the same generic renderer reference', () => {
    const result = buildNodeTypes(['alpha', 'beta', 'gamma']);

    expect(result.alpha).toBeDefined();
    expect(result.alpha).toBe(result.beta);
    expect(result.beta).toBe(result.gamma);
  });

  it('returns deterministically sorted node type keys', () => {
    const result = buildNodeTypes(['gamma', 'alpha', 'beta']);
    expect(Object.keys(result)).toEqual(['alpha', 'beta', 'gamma']);
  });
});
