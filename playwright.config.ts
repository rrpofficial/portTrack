import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * E2E runs against the CONTAINERIZED stack (US-9.7), not a dev server, so the
 * journey exercised is the one users actually get from `docker compose up`.
 *
 * `.env` is read here for the same reason compose reads it: it is where the
 * published port is configured. Without this the suite defaulted to 5173 while
 * the stack was published on whatever `.env` said, so `pnpm test:e2e` failed
 * every test with ERR_CONNECTION_REFUSED — a suite that cannot reach the app it
 * exists to test. A real shell variable still wins, so CI can override.
 */
if (existsSync('.env')) process.loadEnvFile('.env');

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
