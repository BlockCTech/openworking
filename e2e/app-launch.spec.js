const fs = require("node:fs")
const path = require("node:path")
const { test, expect, launchApp } = require("./fixtures")

test.describe("app launch", () => {
  test("opens a window and renders the renderer into #root", async ({ app }) => {
    const { page } = app

    // Window is visible and titled as the product.
    expect(await page.title()).toBeTruthy()

    // The renderer mounts everything into #root; assert it actually rendered.
    const root = page.locator("#root")
    await expect(root).toBeAttached()
    await expect(root).not.toBeEmpty()

    // Sidebar is present (the shell chrome), proving the SPA booted past login.
    await expect(page.locator("aside.sidebar")).toBeVisible()
  })

  test("starts in the empty state with no seeded projects", async ({ app }) => {
    const { page } = app

    // With an empty sandbox userData the empty-state add-project prompt is shown. The sidebar
    // deliberately carries no project/session count badges any more (see the renderer unit test
    // "sidebar omits project and per-project session counts"), so nothing asserts one here.
    await expect(page.locator(".empty-state")).toContainText(/Add a local project/i)
    await expect(page.locator(".empty-state .primary-btn")).toBeVisible()
  })

  test("exposes the openworking preload bridge to the renderer", async ({ app }) => {
    const { page } = app

    // The renderer↔main boundary is the single window.openworking API. If it's
    // missing, contextBridge wiring regressed.
    const hasBridge = await page.evaluate(() => {
      return Boolean(window.openworking && window.openworking.projects && window.openworking.runtime)
    })
    expect(hasBridge).toBe(true)
  })

  test("IPC handlers are registered and respond at startup", async ({ app }) => {
    const { page } = app

    // Regression guard for "No handler registered for '<channel>'": that error meant
    // registerIpc() was skipped (a throw in whenReady before it ran), so the renderer's
    // very first IPC hit no handler. bootstrapMainProcess() now registers handlers and
    // opens the window BEFORE the throw-prone profile sync. Invoke the first IPC the
    // renderer makes (loadInitialState) directly and assert it resolves.
    const result = await page.evaluate(async () => {
      try {
        const activeConfig = await window.openworking.config.get()
        return { ok: true, hasConfig: !!(activeConfig && activeConfig.config) }
      } catch (error) {
        return { ok: false, message: String(error && error.message) }
      }
    })
    expect(result.ok, `config.get() rejected: ${result.message}`).toBe(true)
    expect(result.hasConfig).toBe(true)

    // The SPA booting past loadInitialState() is the user-visible proof the handlers
    // resolved rather than throwing.
    await expect(page.locator("#root")).not.toBeEmpty()
    await expect(page.locator("aside.sidebar")).toBeVisible()
  })

  test("config:get resolves at startup (no null-profile crash)", async ({ app }) => {
    const { page } = app

    // Regression guard for "Cannot read properties of null (reading 'configPath')": when profile
    // init failed, opencodeProfile was left null and config:get — the 3rd call in loadInitialState's
    // Promise.all — crashed, rejecting the whole boot. A ready profile is now guaranteed to be
    // complete, while unavailable profiles are gated behind recovery before config:get can run.
    const result = await page.evaluate(async () => {
      try {
        const cfg = await window.openworking.config.get()
        return { ok: true, hasConfig: Boolean(cfg && cfg.config), hasPath: Boolean(cfg && cfg.path) }
      } catch (error) {
        return { ok: false, message: String(error && error.message) }
      }
    })
    expect(result.ok, `config.get() rejected: ${result.message}`).toBe(true)
    expect(result.hasConfig).toBe(true)
    expect(result.hasPath).toBe(true)
  })

  test("backs up a corrupt config, resets it, and keeps the app usable", async () => {
    const launched = await launchApp({
      onBeforeLaunch: (sandbox) => fs.writeFileSync(sandbox.opencodeConfigPath, "{ not-json }\n")
    })
    try {
      await expect(launched.page.locator(".profile-recovery-banner")).toContainText(/invalid|reset/i)
      await expect(launched.page.locator("aside.sidebar")).toBeVisible()
      const backups = fs.readdirSync(path.dirname(launched.sandbox.opencodeConfigPath))
        .filter((name) => name.startsWith("opencode.json.corrupt-") && name.endsWith(".bak"))
      expect(backups).toHaveLength(1)
      expect(fs.readFileSync(path.join(path.dirname(launched.sandbox.opencodeConfigPath), backups[0]), "utf8")).toBe("{ not-json }\n")
      expect(() => JSON.parse(fs.readFileSync(launched.sandbox.opencodeConfigPath, "utf8"))).not.toThrow()
    } finally {
      await launched.electronApp.close().catch(() => {})
      launched.sandbox.cleanup()
    }
  })

  test("shows recovery for a blocked config path and retries after it is repaired", async () => {
    const launched = await launchApp({
      onBeforeLaunch: (sandbox) => fs.mkdirSync(sandbox.opencodeConfigPath)
    })
    try {
      await expect(launched.page.locator(".profile-recovery-card")).toBeVisible()
      await expect(launched.page.locator(".profile-recovery-card")).toContainText(/config|EISDIR/i)
      const blockedIpc = await launched.page.evaluate(async () => {
        try {
          await window.openworking.config.get()
          return { configResolved: true, message: "" }
        } catch (error) {
          return { configResolved: false, message: String(error?.message || error) }
        }
      })
      expect(blockedIpc.configResolved).toBe(false)
      expect(blockedIpc.message).toMatch(/profile config failed|profile is unavailable/i)
      expect(blockedIpc.message).not.toContain("reading 'configPath'")

      fs.rmdirSync(launched.sandbox.opencodeConfigPath)
      await launched.page.locator('[data-action="retryProfile"]').click()

      await expect(launched.page.locator(".profile-recovery-card")).toHaveCount(0)
      await expect(launched.page.locator("aside.sidebar")).toBeVisible()
      expect(() => JSON.parse(fs.readFileSync(launched.sandbox.opencodeConfigPath, "utf8"))).not.toThrow()
    } finally {
      await launched.electronApp.close().catch(() => {})
      launched.sandbox.cleanup()
    }
  })
})
