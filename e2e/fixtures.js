const { test: base, _electron: electron, expect } = require("@playwright/test")
const { repoRoot, makeSandbox, seedProjects, sandboxEnv } = require("./helpers")

// Launch the Electron app against a fresh sandbox and return the app, its first
// window, and the sandbox. Callers may mutate the sandbox (e.g. seedProjects)
// via the onBeforeLaunch hook before the process starts.
async function launchApp({ seed } = {}) {
  const sandbox = makeSandbox()
  if (seed) {
    // Seed entries default to the sandbox's own project dir so callers only
    // need to supply a name. A directory must exist on disk for the registry.
    const entries = seed.map((entry) => ({ dir: entry.dir || sandbox.projectDir, name: entry.name }))
    seedProjects(sandbox.userDataDir, entries)
  }

  const electronApp = await electron.launch({
    args: ["."],
    cwd: repoRoot,
    env: sandboxEnv(sandbox)
  })
  const page = await electronApp.firstWindow()
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.waitForLoadState("domcontentloaded")
  return { electronApp, page, sandbox }
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

module.exports = { test, expect, launchApp }
