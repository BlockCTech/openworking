const { test, expect, launchApp } = require("./fixtures")

test.describe("navigation", () => {
  // Seeding a project makes the Projects screen render its populated list (the
  // grid + cards), which is what this test is about — with zero projects the
  // screen still shows the "Local projects" header but no cards to speak of.
  let ctx

  test.afterEach(async () => {
    if (ctx) {
      await ctx.electronApp.close().catch(() => {})
      ctx.sandbox.cleanup()
      ctx = null
    }
  })

  test("switches between Projects, Skills, and Settings screens", async () => {
    ctx = await launchApp({ seed: [{ name: "Nav Demo" }] })
    const { page } = ctx

    // Projects screen via the sidebar nav item.
    await page.locator('[data-nav="projects"]').click()
    await expect(page.getByRole("heading", { name: "Local projects" })).toBeVisible()
    await expect(page.locator(".pj-grid")).toBeVisible()
    await expect(page.locator(".pcard .nm").getByText("Nav Demo")).toBeVisible()

    // Skills screen.
    await page.locator('[data-nav="skills"]').click()
    await expect(page.locator(".skills-screen")).toBeVisible()

    // Settings (config) screen from the sidebar footer.
    await page.locator('[data-nav="config"]').click()
    await expect(page.getByRole("heading", { name: "Provider" })).toBeVisible()
  })

  test("project folder is a neutral open/close disclosure", async () => {
    ctx = await launchApp({ seed: [{ name: "Folder Demo" }] })
    const { page } = ctx
    const folderButton = page.locator('[data-toggle-project]').filter({ hasText: "Folder Demo" })
    const folderIcon = folderButton.locator('[data-folder-state]')

    await expect(folderButton).toHaveAttribute("aria-expanded", "true")
    await expect(folderIcon).toHaveAttribute("data-folder-state", "open")
    const openIcon = await folderIcon.innerHTML()
    const openColor = await folderIcon.evaluate((element) => getComputedStyle(element).color)
    await expect(folderIcon.locator("svg")).toHaveCSS("width", "18px")
    await expect(folderIcon.locator("svg")).toHaveCSS("stroke-width", "2px")

    await folderButton.click()
    await page.mouse.move(0, 0)

    await expect(folderButton).toHaveAttribute("aria-expanded", "false")
    await expect(folderIcon).toHaveAttribute("data-folder-state", "closed")
    expect(await folderIcon.innerHTML()).not.toBe(openIcon)
    expect(await folderIcon.evaluate((element) => getComputedStyle(element).color)).toBe(openColor)

    await folderButton.click()
    await expect(folderButton).toHaveAttribute("aria-expanded", "true")
    await expect(folderIcon).toHaveAttribute("data-folder-state", "open")
  })

  test("marks the active nav item", async ({ app }) => {
    const { page } = app

    const projectsNav = page.locator('[data-nav="projects"]')
    await projectsNav.click()
    await expect(projectsNav).toHaveClass(/active/)

    const skillsNav = page.locator('[data-nav="skills"]')
    await skillsNav.click()
    await expect(skillsNav).toHaveClass(/active/)
    await expect(projectsNav).not.toHaveClass(/active/)
  })
})
