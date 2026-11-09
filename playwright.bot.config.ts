import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/bot',
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  outputDir: 'test-results/bot',
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:3012',
    locale: 'zh-CN',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/enterprise/local.mjs start 3012',
    url: 'http://localhost:3012/api/bot/health',
    reuseExistingServer: false,
    timeout: 120000,
    env: { NEXT_PUBLIC_PERSISTENCE: '0', OPENMAIC_AGENT_RUNTIME_ENABLED: '0' },
  },
});
