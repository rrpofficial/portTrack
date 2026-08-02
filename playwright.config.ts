import { defineConfig } from '@playwright/test';

/**
 * E2E runs against the CONTAINERIZED stack (US-9.7), not a dev server, so the
 * journey exercised is the one users actually get from `docker compose up`.
 */
const port = process.env.PORTTRACK_WEB_PORT ?? '5173';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.PORTTRACK_BASE_URL ?? `http://localhost:${port}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
});
