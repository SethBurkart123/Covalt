import { describe, expect, it } from 'vitest';

import { buildNodeTypes } from '../node-types';

describe('buildNodeTypes', () => {
  it('uses a custom component for reroute', () => {
    const result = buildNodeTypes(['alpha', 'reroute']);

    expect(result.reroute).toBeDefined();
    expect(result.reroute).not.toBe(result.alpha);
  });
});
