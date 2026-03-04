import { describe, expect, it } from 'vitest';
import { resolvePlaywrightServerMode } from './server-mode';

describe('resolvePlaywrightServerMode', () => {
  it('defaults to reuse mode outside CI', () => {
    expect(resolvePlaywrightServerMode({ ci: false })).toBe('reuse');
  });

  it('accepts exclusive mode outside CI', () => {
    expect(resolvePlaywrightServerMode({ ci: false, envValue: 'exclusive' })).toBe('exclusive');
  });

  it('accepts reuse mode outside CI', () => {
    expect(resolvePlaywrightServerMode({ ci: false, envValue: 'reuse' })).toBe('reuse');
  });

  it('forces exclusive mode in CI when unset', () => {
    expect(resolvePlaywrightServerMode({ ci: true })).toBe('exclusive');
  });

  it('rejects reuse mode in CI to preserve fail-closed semantics', () => {
    expect(() => resolvePlaywrightServerMode({ ci: true, envValue: 'reuse' })).toThrow(
      /not allowed when CI=true/i,
    );
  });

  it('rejects unknown mode values', () => {
    expect(() => resolvePlaywrightServerMode({ ci: false, envValue: 'shared' })).toThrow(
      /Invalid PLAYWRIGHT_SERVER_MODE/i,
    );
  });
});
