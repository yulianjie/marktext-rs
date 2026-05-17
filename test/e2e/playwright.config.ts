/**
 * Playwright config — drives the running Vite dev server (port 1420) and
 * smoke-tests the renderer UI as a regular web app.
 *
 * Full Tauri-binary E2E would need `tauri-driver` + WebDriver — that's a
 * separate workstream (see PLAN.md Phase 8). The renderer-only tests here
 * still exercise components, routing, Pinia stores, and Muya wiring with
 * the actual frontend bundle — enough to catch most regressions before
 * release.
 *
 * To run: `npm run test:e2e` (assumes the dev server starts itself; the
 * `webServer` block below boots it on demand). To re-record traces:
 * `npx playwright test --trace on`.
 */
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,                    // dev server is single-tenant
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:1420',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:1420',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
