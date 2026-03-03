import type { FullConfig } from '@playwright/test';
import { resolvePlaywrightServerMode } from './server-mode';

function formatModeSummary(mode: ReturnType<typeof resolvePlaywrightServerMode>): string {
  return `Playwright server mode: ${mode} (${mode === 'reuse' ? 'reuse existing 3100/3101 when available' : 'start exclusive owned 3100/3101 servers'})`;
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const mode = resolvePlaywrightServerMode({
    ci: !!process.env.CI,
    envValue: process.env.PLAYWRIGHT_SERVER_MODE,
  });

  const summary = formatModeSummary(mode);
  process.stdout.write(`${summary}\n`);

  if (mode === 'reuse') {
    process.stdout.write(
      "Preflight: running in reusable-server mode; if ports 3100/3101 already host mission services, Playwright will attach instead of failing on contention. Set PLAYWRIGHT_SERVER_MODE=exclusive to force isolated startup.\n",
    );
    return;
  }

  process.stdout.write(
    'Preflight: running in exclusive-server mode; Playwright requires ownership of ports 3100/3101 and will fail fast if they are occupied.\n',
  );
}
