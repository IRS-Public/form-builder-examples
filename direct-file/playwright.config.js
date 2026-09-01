// The smoke test's configuration. See tests/smoke.spec.js for what it covers and why it is small.
import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.SMOKE_PORT ?? 4008)

export default defineConfig({
  testDir: './tests',
  // The suite walks one flow in order and each test starts from a fresh page, so there is nothing to
  // gain from parallelism and one flake-prone shared port to lose.
  workers: 1,
  fullyParallel: false,
  // A failing smoke test means the site does not run; retrying would only make that take longer to
  // find out. CI gets one retry because a cold container occasionally loses the first navigation.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    // The origin only. Routes in the spec carry the app's base path, because a `goto('/x')` against a
    // baseURL with a path replaces that path rather than appending to it.
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node tests/static-server.mjs',
    url: `http://localhost:${PORT}/app/direct-file/`,
    reuseExistingServer: !process.env.CI,
    // `make site` has to have run. Failing here rather than on the first assertion is the difference
    // between "no build" and "the build is broken", which are not the same bug.
    timeout: 15_000,
    env: { SMOKE_PORT: String(PORT) }
  }
})
