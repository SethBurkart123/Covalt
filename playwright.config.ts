import { defineConfig, devices } from '@playwright/test';
import { resolvePlaywrightServerMode } from './tests/playwright/server-mode';

const FRONTEND_URL = 'http://localhost:3101';
const BACKEND_URL = 'http://localhost:3100/';
const PLAYWRIGHT_SERVER_MODE = resolvePlaywrightServerMode({
  ci: !!process.env.CI,
  envValue: process.env.PLAYWRIGHT_SERVER_MODE,
});
const SHOULD_REUSE_EXISTING_SERVER = PLAYWRIGHT_SERVER_MODE === 'reuse';

export default defineConfig({
  globalSetup: './tests/playwright/global-setup.ts',
  testDir: './tests/playwright',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'tests/artifacts/playwright/html-report', open: 'never' }],
    ['json', { outputFile: 'tests/artifacts/playwright/results.json' }],
    ['junit', { outputFile: 'tests/artifacts/playwright/results.xml' }],
  ],
  outputDir: 'tests/artifacts/playwright/test-results',
  use: {
    baseURL: FRONTEND_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'COVALT_BACKEND_PORT=3100 COVALT_DEV_MODE=1 COVALT_GENERATE_TS=0 COVALT_E2E_TESTS=1 uv run main.py',
      url: BACKEND_URL,
      reuseExistingServer: SHOULD_REUSE_EXISTING_SERVER,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'PORT=3101 bun run dev:frontend',
      url: FRONTEND_URL,
      reuseExistingServer: SHOULD_REUSE_EXISTING_SERVER,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
