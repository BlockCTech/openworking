const fs = require("node:fs")
const path = require("node:path")
const { test, expect, _electron: electron } = require("@playwright/test")
const { repoRoot, makeSandbox, seedProjects, sandboxEnv } = require("./helpers")

const fakeRuntime = path.join(repoRoot, "e2e", "fake-opencode-v2.js")

async function waitForPort(portFile) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (fs.existsSync(portFile)) return Number(fs.readFileSync(portFile, "utf8"))
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error("Fake OpenCode v2 runtime did not publish its port.")
}

test("shows and rehydrates the subagent run tree without duplicating child sessions", async () => {
  const sandbox = makeSandbox()
  const portFile = path.join(sandbox.root, "runtime-port")
  seedProjects(sandbox.userDataDir, [{ dir: sandbox.projectDir, name: "subagent-demo" }])

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

    const port = await waitForPort(portFile)
    await expect.poll(() => page.evaluate(async () => (
      (await window.openworking.runtime.listSessions()).map((session) => session.id)
    ))).toEqual(["ses_root", "ses_fork"])
    expect(pageErrors).toEqual([])
    await expect(page.locator('[data-session-id="ses_root"]')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-session-id="ses_child"]')).toHaveCount(0)
    await expect(page.locator('[data-session-id="ses_fork"]')).toBeVisible()

    await page.locator('[data-session-id="ses_root"]').click()
    const card = page.locator(".thread-inner > .subagent-run-tree")
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(card).toContainText("Review the implementation")
    await expect(card.locator(".subagent-run-status")).toHaveText(/Running/)

    await fetch(`http://127.0.0.1:${port}/__test/settle?status=succeeded`)
    await expect(card.locator(".subagent-run-status")).toHaveText(/Succeeded/, { timeout: 10_000 })

    // The missed failure is written only to the durable log while the live SSE connection is
    // closed. The next server.connected signal must make the renderer rehydrate from that log.
    await fetch(`http://127.0.0.1:${port}/__test/disconnect-and-settle?status=failed`)
    await expect(card.locator(".subagent-run-status")).toHaveText(/Failed/, { timeout: 15_000 })
    await expect(page.locator('[data-session-id="ses_child"]')).toHaveCount(0)
    await expect(page.locator('[data-session-id="ses_fork"]')).toBeVisible()
  } finally {
    await app.close().catch(() => {})
    sandbox.cleanup()
  }
})
