const { defineConfig } = require("@playwright/test")

// E2E for the Electron desktop shell. We drive the real app via Playwright's
// _electron launcher (see e2e/fixtures.js); there is no webServer and no
// browser project — every test spawns its own Electron instance against a
// throwaway userData/profile, with the opencode runtime mocked off.
module.exports = defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.js",
  // Electron is heavy to boot; keep parallelism low so we don't exhaust RAM/CPU.
  fullyParallel: true,
  workers: process.env.CI ? 1 : 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure"
  }
})
