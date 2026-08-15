const { test: base, _electron: electron, expect } = require("@playwright/test")
const { repoRoot, makeSandbox, seedProjects, sandboxEnv } = require("./helpers")

// Launch the Electron app against a fresh sandbox and return the app, its first
// window, and the sandbox. Callers may mutate the sandbox (e.g. seedProjects)
// via the onBeforeLaunch hook before the process starts.
async function launchApp({ seed, onBeforeLaunch } = {}) {
  const sandbox = makeSandbox()
  if (seed) {
    // Seed entries default to the sandbox's own project dir so callers only
    // need to supply a name. A directory must exist on disk for the registry.
    const entries = seed.map((entry) => ({ dir: entry.dir || sandbox.projectDir, name: entry.name }))
    seedProjects(sandbox.userDataDir, entries)
  }
  if (onBeforeLaunch) await onBeforeLaunch(sandbox)

  const electronApp = await electron.launch({
    args: ["."],
    cwd: repoRoot,
    env: sandboxEnv(sandbox)
  })
  const page = await electronApp.firstWindow()
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.waitForLoadState("domcontentloaded")
  await dismissFirstRunTour(page)
  return { electronApp, page, sandbox }
}

// The first-run onboarding tour renders a full-screen backdrop that intercepts
// pointer events, so every spec would otherwise have to dismiss it before its
// first click. The throwaway e2e profile never has the "seen" flag, so the tour
// always shows on launch — skip it once here, centrally, right after load.
async function dismissFirstRunTour(page) {
  try {
    const skip = page.locator('.onboarding-backdrop [data-action="onboardingSkip"]')
    await skip.first().waitFor({ state: "visible", timeout: 5000 })
    await skip.first().click()
    await expect(page.locator(".onboarding-backdrop")).toHaveCount(0)
  } catch {
    // Tour not shown (or already dismissed) — nothing to do.
  }
}

// Default fixture: a launched app with no seeded projects (empty state). Tests
// that need projects should use launchApp({ seed }) directly instead.
const test = base.extend({
  app: async ({}, use) => {
    const { electronApp, page, sandbox } = await launchApp()
    try {
      await use({ electronApp, page, sandbox })
    } finally {
      await electronApp.close().catch(() => {})
      sandbox.cleanup()
    }
  }
})

module.exports = { test, expect, launchApp, dismissFirstRunTour }
