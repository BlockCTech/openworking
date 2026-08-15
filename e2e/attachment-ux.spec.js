const fs = require("node:fs")
const path = require("node:path")
const { test, expect, _electron: electron } = require("@playwright/test")
const { repoRoot, makeSandbox, seedProjects, sandboxEnv } = require("./helpers")

const fakeRuntime = path.join(repoRoot, "e2e", "fake-opencode-v2-attachments.js")

async function waitForPort(portFile) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (fs.existsSync(portFile)) return Number(fs.readFileSync(portFile, "utf8"))
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error("Fake OpenCode v2 runtime did not publish its port.")
}

// Stubs Electron's native file dialog for the next "Add photos & files" click. Playwright can't
// drive a real OS dialog, and this codebase deliberately avoids trying to (see e2e/helpers.js).
async function stubNextFilePick(app, filePath) {
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
  }, filePath)
}

test("attach (supported + rejected) -> send -> Undo requires re-attaching", async () => {
  const sandbox = makeSandbox()
  const portFile = path.join(sandbox.root, "runtime-port")
  seedProjects(sandbox.userDataDir, [{ dir: sandbox.projectDir, name: "attachment-demo" }])

  // The rejection is driven by the LOCAL profile config, not by what the runtime advertises (see
  // src/renderer/attachment-capabilities.js) — and the shipped default allows image + pdf. Pin a
  // text-only model here so attaching a png is actually unsupported.
  const { DEFAULT_CONFIG } = require(path.join(repoRoot, "src", "opencode-config"))
  const textOnlyConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG))
  for (const provider of Object.values(textOnlyConfig.provider || {})) {
    for (const model of Object.values(provider.models || {})) {
      model.modalities = { input: ["text"], output: ["text"] }
    }
  }
  fs.writeFileSync(sandbox.opencodeConfigPath, `${JSON.stringify(textOnlyConfig, null, 2)}\n`)

  const notesPath = path.join(sandbox.root, "notes.txt")
  fs.writeFileSync(notesPath, "some notes\n")
  const imagePath = path.join(sandbox.root, "photo.png")
  fs.writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

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

    // Attach a supported (text) file — the fake model only declares capabilities.input: ["text"].
    await stubNextFilePick(app, notesPath)
    await page.locator('[data-popover="plus"]').click()
    await page.locator('[data-action="attachment"]').click()
    await expect(page.locator("#attachmentChipsRoot .attachment-chip")).toHaveCount(1, { timeout: 10_000 })
    await expect(page.locator("#attachmentChipsRoot .attachment-chip")).toContainText("notes.txt")

    // Attach an unsupported (image) file — must be rejected before it ever becomes a chip.
    await stubNextFilePick(app, imagePath)
    await page.locator('[data-popover="plus"]').click()
    await page.locator('[data-action="attachment"]').click()
    await expect(page.locator("#toastHost")).toContainText("doesn't support", { timeout: 10_000 })
    await expect(page.locator("#attachmentChipsRoot .attachment-chip")).toHaveCount(1)
    await expect(page.locator("#attachmentChipsRoot .attachment-chip")).not.toContainText("photo.png")

    // Send with the one valid attachment.
    await page.locator("#promptInput").click()
    await page.keyboard.type("Please review this")
    await page.locator('[data-action="sendPrompt"]').click()
    await expect(page.locator(".msg-user .attachment-chip")).toBeVisible({ timeout: 15_000 })
    await expect(page.locator(".msg-user .attachment-chip")).toContainText("notes.txt")
    await expect(page.locator("#attachmentChipsRoot .attachment-chip")).toHaveCount(0)

    // Undo the last prompt: the draft text comes back, but the attachment must not silently
    // reappear — this is the exact behavior test/renderer.test.js asserts at the state level;
    // this proves it holds through the real UI as well.
    await page.locator('[data-popover="plus"]').click()
    await page.locator('[data-action="undoSession"]').click()
    await expect(page.locator(".revert-confirm-modal")).toBeVisible({ timeout: 10_000 })
    await page.locator('[data-action="confirmSessionRevert"]').click()
    await expect(page.locator(".revert-confirm-modal")).toHaveCount(0)
    await expect(page.locator("#promptInput")).toContainText("Please review this", { timeout: 10_000 })
    await expect(page.locator("#attachmentChipsRoot .attachment-chip")).toHaveCount(0)

    expect(pageErrors).toEqual([])
  } finally {
    await app.close().catch(() => {})
    sandbox.cleanup()
  }
})
