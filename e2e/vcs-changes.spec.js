const { test, expect, _electron: electron } = require("@playwright/test")
const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

const { repoRoot, makeSandbox, seedProjects, sandboxEnv } = require("./helpers")

// Unlike the other specs, this one boots the REAL bundled opencode runtime: the Changes panel
// reads /api/vcs/status from it, so a stubbed-out binary would only ever prove the empty state.
const runtimeBin = path.join(repoRoot, "node_modules/.bin/opencode2")

function git(cwd, ...args) {
  execFileSync("git", args, { cwd, stdio: "pipe" })
}

// A repo with one file of each status the panel renders.
function seedRepo(dir) {
  git(dir, "init", "-q", ".")
  git(dir, "config", "user.email", "e2e@test.local")
  git(dir, "config", "user.name", "e2e")
  fs.writeFileSync(path.join(dir, "app.js"), "const a = 1\nconst b = 2\n")
  fs.writeFileSync(path.join(dir, "obsolete.txt"), "removeme\n")
  git(dir, "add", "-A")
  git(dir, "commit", "-qm", "init")
  fs.writeFileSync(path.join(dir, "app.js"), "const a = 1\nconst b = 22\nconst c = 3\n")
  fs.rmSync(path.join(dir, "obsolete.txt"))
  fs.writeFileSync(path.join(dir, "brand-new.js"), "fresh file\n")
}

test.describe("VCS Changes panel", () => {
  let sandbox
  let app
  let page

  test.beforeAll(async () => {
    test.skip(!fs.existsSync(runtimeBin), "bundled opencode runtime is not installed")
    sandbox = makeSandbox()
    seedRepo(sandbox.projectDir)
    seedProjects(sandbox.userDataDir, [{ dir: sandbox.projectDir, name: "vcs-demo" }])

    app = await electron.launch({
      args: ["."],
      cwd: repoRoot,
      env: { ...sandboxEnv(sandbox), OPENWORKING_RUNTIME_BIN: runtimeBin }
    })
    page = await app.firstWindow()
    await page.waitForLoadState("domcontentloaded")
    // The first-run tour renders after boot and its backdrop swallows every click, so wait for it
    // and dismiss it rather than racing it (fixtures.js does the same for the other specs).
    const skip = page.locator('.onboarding-backdrop [data-action="onboardingSkip"]')
    await skip.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {})
    if (await skip.count()) await skip.click()
    await expect(page.locator(".onboarding-backdrop")).toHaveCount(0)
  })

  test.afterAll(async () => {
    if (app) await app.close()
    if (sandbox) sandbox.cleanup()
  })

  test("lists added/modified/deleted files and opens a real diff", async () => {
    // Open the project, then the right sidebar.
    // The app boots on the New session screen (renderer state nav: "session"), so the project
    // cards only exist after switching to Projects.
    await page.locator('[data-nav="projects"]').click()
    await page.locator("[data-open-project]").first().click()
    await page.locator('[data-action="toggleRightSidebar"]').click()
    await expect(page.locator(".right-file-sidebar")).toBeVisible()

    // Switch to Changes.
    await page.locator('[data-right-tab="changes"]').click()
    await expect(page.locator('[data-right-tab="changes"]')).toHaveClass(/active/)

    // The runtime needs a moment to come up before status resolves.
    await expect(page.locator('[data-vcs-file="app.js"]')).toBeVisible({ timeout: 45_000 })
    await expect(page.locator('[data-vcs-file="brand-new.js"]')).toBeVisible()
    await expect(page.locator('[data-vcs-file="obsolete.txt"]')).toBeVisible()

    // Each status renders its own badge.
    await expect(page.locator('[data-vcs-file="brand-new.js"] .vcs-badge.added')).toHaveText("A")
    await expect(page.locator('[data-vcs-file="app.js"] .vcs-badge.modified')).toHaveText("M")
    await expect(page.locator('[data-vcs-file="obsolete.txt"] .vcs-badge.deleted')).toHaveText("D")

    // Clicking a row fetches that file's patch and opens the diff view.
    await page.locator('[data-vcs-file="app.js"]').click()
    await expect(page.locator(".document-viewer")).toBeVisible()
    const diff = page.locator(".document-viewer .diff-view")
    await expect(diff).toBeVisible({ timeout: 15_000 })
    await expect(diff).toContainText("const c = 3")
  })

  test("a deleted file opens its diff without a read error", async () => {
    // Tests share one app instance but not one another's UI state, so re-open the panel here
    // rather than depending on where the previous test left it.
    if (!(await page.locator('[data-vcs-file="obsolete.txt"]').count())) {
      if (!(await page.locator(".right-file-sidebar").count())) {
        // The app boots on the New session screen (renderer state nav: "session"), so the project
        // cards only exist after switching to Projects.
        await page.locator('[data-nav="projects"]').click()
        await page.locator("[data-open-project]").first().click()
        await page.locator('[data-action="toggleRightSidebar"]').click()
      }
      await page.locator('[data-right-tab="changes"]').click()
    }
    await expect(page.locator('[data-vcs-file="obsolete.txt"]')).toBeVisible({ timeout: 45_000 })
    await page.locator('[data-vcs-file="obsolete.txt"]').click()
    const viewer = page.locator(".document-viewer")
    await expect(viewer).toBeVisible()
    await expect(viewer.locator(".diff-view")).toContainText("removeme", { timeout: 15_000 })
    await expect(viewer).not.toContainText("does not exist")
  })
})
