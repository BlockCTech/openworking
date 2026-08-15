const fs = require("node:fs")
const path = require("node:path")
const { test, expect, _electron: electron } = require("@playwright/test")
const { repoRoot, makeSandbox, seedProjects, sandboxEnv } = require("./helpers")

const fakeRuntime = path.join(repoRoot, "e2e", "fake-agent-progress-v2.js")

test.describe.configure({ mode: "serial" })

async function waitForPort(portFile) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (fs.existsSync(portFile)) return Number(fs.readFileSync(portFile, "utf8"))
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error("Fake agent-progress runtime did not publish its port.")
}

test("paces live progress boundaries and collapses completed progress outside tools and final text", async () => {
  const sandbox = makeSandbox()
  const portFile = path.join(sandbox.root, "runtime-port")
  seedProjects(sandbox.userDataDir, [{ dir: sandbox.projectDir, name: "agent-progress-demo" }])

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
    await expect(page.locator('[data-session-id="ses_progress"]')).toBeVisible({ timeout: 15_000 })
    await page.locator('[data-session-id="ses_progress"]').click()

    const start = Date.now()
    await fetch(`http://127.0.0.1:${port}/__test/start`)
    const liveProgress = page.locator(".reasoning-block")
    await expect(liveProgress).toContainText("LIVE_PROGRESS_BOUNDARY_START", { timeout: 1_500 })
    await page.waitForTimeout(250)
    await expect(liveProgress).not.toContainText("LIVE_PROGRESS_BOUNDARY_END")
    await expect(liveProgress).toContainText("LIVE_PROGRESS_BOUNDARY_END", { timeout: 8_000 })
    expect(Date.now() - start).toBeGreaterThan(3_000)
    await expect(page.locator("body")).not.toContainText("<|channel|>")
    await expect(page.locator("body")).not.toContainText("<channel|>")
    await expect(page.locator(".assistant-message .message-actions")).toHaveCount(0)
    await expect(page.locator(".agent-progress-card")).toHaveCount(0)
    await expect(page.locator(".thinking")).toHaveCount(0)
    await expect(page.locator(".tool-step")).toBeVisible()

    await fetch(`http://127.0.0.1:${port}/__test/finish`)
    const card = page.locator(".agent-progress-card")
    await expect(card).toHaveCount(1)
    const toggle = card.locator(".agent-progress-head")
    await expect(toggle).toContainText("Agent progress")
    await expect(toggle).toContainText("2 updates")
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await expect(card.locator(".agent-progress-body")).toBeHidden()

    await expect(page.getByText("FINAL_ANSWER_OUTSIDE_PROGRESS_CARD")).toBeVisible()
    await expect(page.locator(".assistant-message .message-actions")).toHaveCount(1)
    await expect(page.locator(".tool-step")).toBeVisible()
    await expect(card.locator(".tool-step")).toHaveCount(0)
    expect(await card.getByText("FINAL_ANSWER_OUTSIDE_PROGRESS_CARD").count()).toBe(0)

    await toggle.click()
    await expect(toggle).toHaveAttribute("aria-expanded", "true")
    await expect(card.locator(".agent-progress-body")).toBeVisible()
    await expect(card).toContainText("LIVE_PROGRESS_BOUNDARY_START")
    await expect(card).toContainText("Preparing the final response.")
    expect(pageErrors).toEqual([])
  } finally {
    await app.close().catch(() => {})
    sandbox.cleanup()
  }
})

test("shows native v2 tool calling immediately without Agent progress or fake tool pacing", async () => {
  const sandbox = makeSandbox()
  const portFile = path.join(sandbox.root, "runtime-port")
  seedProjects(sandbox.userDataDir, [{ dir: sandbox.projectDir, name: "tool-calling-demo" }])

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
    await expect(page.locator('[data-session-id="ses_tool_calling"]')).toBeVisible({ timeout: 15_000 })
    await page.locator('[data-session-id="ses_tool_calling"]').click()

    await fetch(`http://127.0.0.1:${port}/__test/start-tool`)
    const tool = page.locator(".tool-step").filter({ hasText: "Searching the web - nhiệt độ đà nẵng hôm nay" })
    await expect(tool).toBeVisible({ timeout: 1_500 })
    await expect(tool).toContainText("Processing")
    await expect(page.locator(".thinking")).toHaveCount(0)
    await expect(page.locator(".reasoning-block")).toHaveCount(0)
    await expect(page.locator(".agent-progress-card")).toHaveCount(0)

    await fetch(`http://127.0.0.1:${port}/__test/finish-tool`)
    const completed = page.locator(".tool-step.completed").filter({ hasText: "Searched the web - nhiệt độ đà nẵng hôm nay" })
    await expect(completed).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText("Da Nang weather result")).toBeVisible()
    await expect(page.locator(".tool-step")).toHaveCount(1)
    expect(pageErrors).toEqual([])
  } finally {
    await app.close().catch(() => {})
    sandbox.cleanup()
  }
})
