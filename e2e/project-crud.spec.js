const { test, expect, launchApp } = require("./fixtures")

// These tests seed a project into projects.json before launch (the real
// "Add project" button opens a native folder dialog Playwright can't drive),
// then exercise rename/remove entirely through the UI from the Projects screen.
test.describe("project rename & remove", () => {
  let ctx

  test.afterEach(async () => {
    if (ctx) {
      await ctx.electronApp.close().catch(() => {})
      ctx.sandbox.cleanup()
      ctx = null
    }
  })

  test("seeded project appears on the Projects screen", async () => {
    ctx = await launchApp({ seed: [{ dir: undefined, name: "Demo Project" }] })
    // dir undefined -> fall back to the sandbox project dir.
    const { page } = ctx
    await page.locator('[data-nav="projects"]').click()
    await expect(page.locator(".pcard .nm").getByText("Demo Project")).toBeVisible()
  })

  test("renames a project through the rename modal", async () => {
    ctx = await launchApp({ seed: [{ name: "Old Name" }] })
    const { page } = ctx

    await page.locator('[data-nav="projects"]').click()
    await expect(page.locator(".pcard .nm").getByText("Old Name")).toBeVisible()

    // Open rename modal from the project card.
    await page.locator("[data-rename-project]").first().click()
    await expect(page.locator(".rename-modal")).toBeVisible()

    const input = page.locator("[data-project-rename-input]")
    await input.fill("New Name")
    await page.locator('[data-action="confirmRenameProject"]').click()

    // Modal closes and the new name is reflected in the list.
    await expect(page.locator(".rename-modal")).toHaveCount(0)
    await expect(page.locator(".pcard .nm").getByText("New Name")).toBeVisible()
    await expect(page.locator(".pcard .nm").getByText("Old Name")).toHaveCount(0)
  })

  test("blocks renaming to an empty name", async () => {
    ctx = await launchApp({ seed: [{ name: "Keep Me" }] })
    const { page } = ctx

    await page.locator('[data-nav="projects"]').click()
    await page.locator("[data-rename-project]").first().click()
    await page.locator("[data-project-rename-input]").fill("")
    await page.locator('[data-action="confirmRenameProject"]').click()

    // Validation error shown, modal stays open, name unchanged.
    await expect(page.locator(".rename-modal .field-error")).toContainText(/required/i)
    await expect(page.locator(".rename-modal")).toBeVisible()
  })

  test("removes a project through the confirm modal", async () => {
    ctx = await launchApp({ seed: [{ name: "Trash Me" }] })
    const { page } = ctx

    await page.locator('[data-nav="projects"]').click()
    await expect(page.locator(".pcard .nm").getByText("Trash Me")).toBeVisible()

    await page.locator("[data-remove-project]").first().click()
    await expect(page.locator(".confirm-modal")).toBeVisible()
    await page.locator('[data-action="confirmRemoveProject"]').click()

    // List empties out. There is no count badge to check any more — the sidebar deliberately
    // dropped project/session counts (see the "sidebar omits project and per-project session
    // counts" renderer test), so the disappearance of the card is the assertion.
    await expect(page.locator(".pcard .nm").getByText("Trash Me")).toHaveCount(0)
  })
})
