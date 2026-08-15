const test = require("node:test")
const assert = require("node:assert/strict")
const { IDE_APP_NAMES, ideAppName, openInIde } = require("../src/ide-launcher")

test("ideAppName maps supported IDE ids to their macOS app name", () => {
  assert.equal(ideAppName("vscode"), "Visual Studio Code")
  assert.equal(ideAppName("cursor"), "Cursor")
  assert.equal(ideAppName("antigravity"), "Antigravity IDE")
})

test("ideAppName returns null for system and unknown ids", () => {
  assert.equal(ideAppName("system"), null)
  assert.equal(ideAppName("nope"), null)
})

test("openInIde runs `open -a <app> <path>` as an argument array, not a shell string", async () => {
  const calls = []
  const exec = (cmd, args, callback) => {
    calls.push([cmd, ...args])
    callback(null)
  }

  await openInIde("cursor", "/Users/me/My Project", { exec, platform: "darwin" })

  assert.deepEqual(calls, [["open", "-a", "Cursor", "/Users/me/My Project"]])
})

test("openInIde rejects with a readable message when the app is not installed", async () => {
  const exec = (cmd, args, callback) => callback(new Error("spawn open ENOENT"))

  await assert.rejects(
    openInIde("vscode", "/Users/me/proj", { exec, platform: "darwin" }),
    /Could not open Visual Studio Code\. Is it installed\?/
  )
})

test("openInIde rejects for an unsupported IDE id without shelling out", async () => {
  let called = false
  const exec = () => { called = true }

  await assert.rejects(openInIde("system", "/Users/me/proj", { exec }), /Unsupported IDE: system/)
  assert.equal(called, false)
})

test("openInIde rejects with a readable message on Windows", async () => {
  let called = false
  const exec = () => { called = true }

  await assert.rejects(
    openInIde("vscode", "C:\\Projects\\app", { exec, platform: "win32" }),
    /currently supported on macOS only/
  )
  assert.equal(called, false)
})

test("IDE_APP_NAMES has no entry for system (handled via shell.openPath by the caller)", () => {
  assert.equal(Object.hasOwn(IDE_APP_NAMES, "system"), false)
})
