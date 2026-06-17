const { test, expect } = require("./fixtures")

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

    // With an empty sandbox userData, the project count badge reads 0 and the
    // empty-state add-project prompt is shown.
    await expect(page.locator(".nav-item .count").first()).toHaveText("0")
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
})
