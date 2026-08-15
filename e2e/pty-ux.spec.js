const fs = require("node:fs")
const path = require("node:path")
const { test, expect, _electron: electron } = require("@playwright/test")
const { repoRoot, makeSandbox, seedProjects, sandboxEnv } = require("./helpers")

const fakeRuntime = path.join(repoRoot, "e2e", "fake-opencode-v2-pty.js")

async function waitForPort(portFile) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (fs.existsSync(portFile)) return Number(fs.readFileSync(portFile, "utf8"))
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error("Fake OpenCode v2 runtime did not publish its port.")
}

test("open a terminal, confirm the dialog, type a command, see it echoed, then close it", async () => {
  const sandbox = makeSandbox()
  const portFile = path.join(sandbox.root, "runtime-port")
  seedProjects(sandbox.userDataDir, [{ dir: sandbox.projectDir, name: "pty-demo" }])

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

    // Terminal is a bottom dock toggled from the header, next to the IDE split button — not a
    // right-sidebar tab.
    await page.locator('[data-action="toggleTerminalPanel"]').click()
    await expect(page.locator(".terminal-dock")).toBeVisible({ timeout: 5_000 })
    await expect(page.locator(".terminal-panel")).toContainText("No terminal open", { timeout: 10_000 })

    await page.locator('[data-action="openTerminalConfirm"]').click()
    await expect(page.locator(".confirm-modal", { hasText: "Open a terminal?" })).toBeVisible({ timeout: 5_000 })
    await page.locator('.confirm-modal [data-action="confirmOpenTerminal"]').click()

    await expect(page.locator(".terminal-status-badge")).toHaveText("Connected", { timeout: 10_000 })
    await expect(page.locator(".terminal-xterm-host .xterm")).toBeVisible({ timeout: 10_000 })

    // xterm captures keyboard input on its own hidden textarea once focused.
    await page.locator(".terminal-xterm-host").click()
    await page.keyboard.type("hello-terminal")
    await page.keyboard.press("Enter")
    await expect(page.locator(".terminal-xterm-host")).toContainText("echo: hello-terminal", { timeout: 10_000 })

    await page.locator('[data-action="closeTerminal"]').click()
    await expect(page.locator(".terminal-panel")).toContainText("No terminal open", { timeout: 10_000 })

    expect(pageErrors).toEqual([])
  } finally {
    await app.close().catch(() => {})
    sandbox.cleanup()
  }
})
