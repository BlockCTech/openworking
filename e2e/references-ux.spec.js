const fs = require("node:fs")
const path = require("node:path")
const { test, expect, _electron: electron } = require("@playwright/test")
const { repoRoot, makeSandbox, seedProjects, sandboxEnv } = require("./helpers")

// Reuses the attachment smoke flow's fake runtime — References doesn't touch attachments, but the
// fixture already answers every endpoint opening a project/session needs (health/event/model/
// command/skill/mcp/session), and /api/reference is deliberately NOT implemented there: main.js's
// references:list handler treats the runtime's own list as best-effort (.catch(() => [])), so a
// 404 on that path is exactly the "always empty" behavior confirmed against the real pinned
// opencode2 binary — config stays the sole source of truth for this flow either way.
const fakeRuntime = path.join(repoRoot, "e2e", "fake-opencode-v2-attachments.js")

async function waitForPort(portFile) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (fs.existsSync(portFile)) return Number(fs.readFileSync(portFile, "utf8"))
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error("Fake OpenCode v2 runtime did not publish its port.")
}

test("add a reference through the References panel, see it listed, then remove it", async () => {
  const sandbox = makeSandbox()
  const portFile = path.join(sandbox.root, "runtime-port")
  seedProjects(sandbox.userDataDir, [{ dir: sandbox.projectDir, name: "references-demo" }])

  // assertReferencePath requires the target to actually exist on disk inside the project.
  const docsDir = path.join(sandbox.projectDir, "docs")
  fs.mkdirSync(docsDir, { recursive: true })

  const app = await electron.launch({
    args: ["."],
    cwd: repoRoot,
    env: {
      ...sandboxEnv(sandbox),
      OPENWORKING_RUNTIME_BIN: fakeRuntime,
      OPENWORKING_FAKE_PROJECT_DIR: sandbox.projectDir,
      OPENWORKING_FAKE_RUNTIME_PORT_FILE: portFile
    }
  })
  try {
    const page = await app.firstWindow()
    const pageErrors = []
    page.on("pageerror", (error) => pageErrors.push(error.message))
    await page.waitForLoadState("domcontentloaded")
    const skip = page.locator('.onboarding-backdrop [data-action="onboardingSkip"]')
    await skip.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {})
    if (await skip.count()) await skip.click()

    await waitForPort(portFile)
    // The app boots on the New session screen (renderer state nav: "session"), so the project
    // cards only exist after switching to Projects.
    await page.locator('[data-nav="projects"]').click()
    await page.locator("[data-open-project]").first().click()

    await page.locator('[data-nav="skills"]').click()
    await page.locator('[data-skills-tab="references"]').click()
    await expect(page.locator('[data-panel="references"]')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-panel="references"]')).toContainText("No references yet")

    await page.locator('[data-action="openReferenceForm"]').click()
    await page.locator("#refName").fill("docs")
    await page.locator("#refPath").fill("docs")
    await page.locator('[data-action="addReference"]').click()

    const row = page.locator('[data-panel="references"] .row', { hasText: "docs" })
    await expect(row).toBeVisible({ timeout: 10_000 })
    await expect(row.locator(".tag.ref-broken")).toHaveCount(0)

    await page.locator('[data-reference-remove="docs"]').click()
    await expect(page.locator('[data-panel="references"] .row', { hasText: "docs" })).toHaveCount(0, { timeout: 10_000 })
    await expect(page.locator('[data-panel="references"]')).toContainText("No references yet")

    expect(pageErrors).toEqual([])
  } finally {
    await app.close().catch(() => {})
    sandbox.cleanup()
  }
})
