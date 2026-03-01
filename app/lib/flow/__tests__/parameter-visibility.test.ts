
import { describe, it, expect } from 'vitest';
import { shouldRenderParam, type NodeEdgeIndex } from '@/components/flow/parameter-visibility';
import type { Parameter } from '@/lib/flow';

const index: NodeEdgeIndex = { incoming: [], outgoing: [] };

function baseParam(showWhen: Parameter['showWhen']): Parameter {
  return {
    id: 'p1',
    type: 'string',
    label: 'Param',
    mode: 'constant',
    showWhen,
  };
}

describe('parameter visibility (value-based)', () => {
  it('supports valueEquals', () => {
    const param = baseParam({ valueEquals: [{ paramId: 'mode', value: 'advanced' }] });
    expect(shouldRenderParam(param, 'node', index, { mode: 'advanced' })).toBe(true);
    expect(shouldRenderParam(param, 'node', index, { mode: 'basic' })).toBe(false);
  });

  it('supports valueIn', () => {
    const param = baseParam({ valueIn: [{ paramId: 'kind', values: ['a', 'b'] }] });
    expect(shouldRenderParam(param, 'inspector', index, { kind: 'a' })).toBe(true);
    expect(shouldRenderParam(param, 'inspector', index, { kind: 'z' })).toBe(false);
  });

  it('supports exists/notExists', () => {
    const existsParam = baseParam({ exists: ['token'] });
    const notExistsParam = baseParam({ notExists: ['token'] });
    expect(shouldRenderParam(existsParam, 'node', index, { token: 'x' })).toBe(true);
    expect(shouldRenderParam(existsParam, 'node', index, {})).toBe(false);
    expect(shouldRenderParam(notExistsParam, 'node', index, {})).toBe(true);
    expect(shouldRenderParam(notExistsParam, 'node', index, { token: 'x' })).toBe(false);
  });
});
