type PlaywrightServerMode = 'exclusive' | 'reuse';

interface ResolvePlaywrightServerModeInput {
  ci: boolean;
  envValue?: string;
}

const VALID_SERVER_MODES = new Set<PlaywrightServerMode>(['exclusive', 'reuse']);

function parseServerMode(rawValue?: string): PlaywrightServerMode | null {
  if (!rawValue) {
    return null;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return VALID_SERVER_MODES.has(normalized as PlaywrightServerMode)
    ? (normalized as PlaywrightServerMode)
    : null;
}

function invalidModeMessage(value: string): string {
  return `Invalid PLAYWRIGHT_SERVER_MODE value '${value}'. Use 'reuse' or 'exclusive'.`;
}

export function resolvePlaywrightServerMode({
  ci,
  envValue,
}: ResolvePlaywrightServerModeInput): PlaywrightServerMode {
  const requestedMode = parseServerMode(envValue);

  if (envValue && requestedMode === null) {
    throw new Error(invalidModeMessage(envValue));
  }

  if (ci) {
    if (requestedMode === 'reuse') {
      throw new Error(
        'PLAYWRIGHT_SERVER_MODE=reuse is not allowed when CI=true. Use exclusive server mode in CI to keep gates fail-closed.',
      );
    }
    return 'exclusive';
  }

  return requestedMode ?? 'reuse';
}
