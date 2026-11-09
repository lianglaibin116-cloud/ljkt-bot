import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/teacher',
  outputDir: 'test-results/teacher-e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/teacher', open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:3012',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
  },
  webServer: {
    command:
      process.env.TEACHER_E2E_PRODUCTION === '1'
        ? 'node scripts/enterprise/local.mjs start 3012'
        : 'node scripts/enterprise/local.mjs dev 3012',
    url: 'http://localhost:3012/api/health/live',
    // Never run acceptance against an unknown server or the user's normal port.
    reuseExistingServer: false,
    timeout: 120_000,
    env: { NEXT_PUBLIC_PERSISTENCE: '0', OPENMAIC_AGENT_RUNTIME_ENABLED: '0' },
  },
});
