const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const {
  BACKLOG_PACKAGE,
  backlogInstallDir,
  backlogEntryPath,
  backlogCommand,
  isLegacyBacklogNpxCommand,
  ensureBacklogServer
} = require("../src/mcp-install")

function tempProfile() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openworking-mcpinstall-"))
}

test("isLegacyBacklogNpxCommand matches the npx invocation and nothing else", () => {
  assert.equal(isLegacyBacklogNpxCommand(["npx", BACKLOG_PACKAGE]), true)
  assert.equal(isLegacyBacklogNpxCommand(["npx", "-y", BACKLOG_PACKAGE]), true)
  assert.equal(isLegacyBacklogNpxCommand(["node", "/abs/build/index.js"]), false)
  assert.equal(isLegacyBacklogNpxCommand(["npx", "some-other-server"]), false)
  assert.equal(isLegacyBacklogNpxCommand("npx backlog-mcp-server"), false) // only array form
  assert.equal(isLegacyBacklogNpxCommand(undefined), false)
})

test("backlogCommand returns node + the entry path under the profile", () => {
  const profileDir = tempProfile()
  try {
    const command = backlogCommand(profileDir)
    assert.equal(command[0], "node")
    assert.equal(command[1], backlogEntryPath(profileDir))
    assert.ok(command[1].startsWith(backlogInstallDir(profileDir)))
  } finally {
    fs.rmSync(profileDir, { recursive: true, force: true })
  }
})

test("ensureBacklogServer is idempotent: returns the entry without installing when present", async () => {
  const profileDir = tempProfile()
  try {
    // Pre-create the installed entry so ensure should short-circuit.
    const entry = backlogEntryPath(profileDir)
    fs.mkdirSync(path.dirname(entry), { recursive: true })
    fs.writeFileSync(entry, "// stub\n")

    let installCalled = false
    const resolvePath = async () => {
      installCalled = true
      return process.env.PATH
    }
    const result = await ensureBacklogServer(profileDir, { resolvePath })
    assert.equal(result, entry)
    assert.equal(installCalled, false, "resolvePath/install must not run when already installed")
  } finally {
    fs.rmSync(profileDir, { recursive: true, force: true })
  }
})

test("ensureBacklogServer surfaces a clear error when install fails", async () => {
  const profileDir = tempProfile()
  try {
    // Point PATH at an empty dir so `npm` cannot be found → install fails deterministically offline.
    const emptyBin = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-emptybin-"))
    const resolvePath = async () => emptyBin
    await assert.rejects(
      ensureBacklogServer(profileDir, { resolvePath }),
      (error) => /install/i.test(error.message)
    )
    // A neutral scaffold package.json (no devEngines) must have been created in the install dir.
    const scaffold = path.join(backlogInstallDir(profileDir), "package.json")
    assert.ok(fs.existsSync(scaffold))
    const pkg = JSON.parse(fs.readFileSync(scaffold, "utf8"))
    assert.equal(pkg.devEngines, undefined)
    fs.rmSync(emptyBin, { recursive: true, force: true })
  } finally {
    fs.rmSync(profileDir, { recursive: true, force: true })
  }
})

test("ensureBacklogServer requires a profileDir", async () => {
  await assert.rejects(ensureBacklogServer(""), /profileDir/)
})
