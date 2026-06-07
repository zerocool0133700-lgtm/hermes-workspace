import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config for the hermes-workspace e2e suite.
 *
 * The `webServer` block builds the app and serves the real SSR server
 * (server-entry.js) on E2E_PORT — an ephemeral, self-contained instance. Specs
 * stub the backend gateway calls they depend on via `page.route` (see
 * e2e/fixtures.ts), so the suite is deterministic without a live hermes-agent.
 *
 * Locally, set E2E_REUSE=1 (or run `pnpm start` yourself) to reuse a running
 * server instead of rebuilding each run.
 */

const PORT = Number(process.env.E2E_PORT || 3100)
const BASE_URL = process.env.HERMES_WORKSPACE_URL || `http://127.0.0.1:${PORT}`
const reuse = process.env.E2E_REUSE === '1' || !process.env.CI

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Only manage a server when targeting the local default URL. If
  // HERMES_WORKSPACE_URL points elsewhere, assume it's already running.
  webServer: process.env.HERMES_WORKSPACE_URL
    ? undefined
    : {
        // Use corepack so it resolves whether or not `pnpm` is on PATH.
        command: 'corepack pnpm build && corepack pnpm start',
        url: BASE_URL,
        timeout: 180_000,
        reuseExistingServer: reuse,
        env: {
          PORT: String(PORT),
          HOST: '127.0.0.1',
          NODE_ENV: 'production',
        },
      },
})
