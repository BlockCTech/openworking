const { test, expect } = require("./fixtures")

test.describe("navigation", () => {
  test("switches between Projects, Skills, and Settings screens", async ({ app }) => {
    const { page } = app

    // Projects screen via the sidebar nav item.
    await page.locator('[data-nav="projects"]').click()
    await expect(page.getByRole("heading", { name: "Local projects" })).toBeVisible()
    await expect(page.locator(".admin-panel")).toBeVisible()

    // Skills screen.
    await page.locator('[data-nav="skills"]').click()
    await expect(page.locator(".skills-screen")).toBeVisible()

    // Settings (config) screen from the sidebar footer.
    await page.locator('[data-nav="config"]').click()
    await expect(page.getByRole("heading", { name: "Provider" })).toBeVisible()
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
