const test = require("node:test")
const assert = require("node:assert/strict")
const { bootstrapMainProcess } = require("../src/main-bootstrap")
const { ProfileLifecycle } = require("../src/profile-lifecycle")

// Records the order in which the injected boot steps run so the ordering invariant
// can be asserted directly. Each spy pushes its own label before doing anything else.
function makeSpies({ ensureProfile } = {}) {
  const calls = []
  return {
    calls,
    deps: {
      registerIpc: () => calls.push("registerIpc"),
      applyMenu: () => calls.push("applyMenu"),
      createWindow: () => calls.push("createWindow"),
      ensureProfile: () => {
        calls.push("ensureProfile")
        if (ensureProfile) return ensureProfile()
        return { profileDir: "/profile" }
      },
      onProfileError: (error) => calls.push(`onProfileError:${error.message}`)
    }
  }
}

test("bootstrapMainProcess registers IPC, settles profile state, then opens the window", () => {
  const { calls, deps } = makeSpies()

  const result = bootstrapMainProcess(deps)

  assert.deepEqual(calls, ["registerIpc", "applyMenu", "ensureProfile", "createWindow"])
  assert.ok(
    calls.indexOf("registerIpc") < calls.indexOf("ensureProfile"),
    "IPC must be registered before profile initialization"
  )
  assert.deepEqual(result, { profileDir: "/profile" })
})

test("bootstrapMainProcess still registers IPC and opens the window when profile sync throws", () => {
  // Reproduces the root cause of "No handler registered for '<channel>'": profile init
  // fails on startup. Handlers and the window must be wired up regardless, and the
  // failure must be reported (not swallowed, not rethrown).
  const { calls, deps } = makeSpies({
    ensureProfile: () => {
      throw new Error("profile boom")
    }
  })

  let result
  assert.doesNotThrow(() => {
    result = bootstrapMainProcess(deps)
  }, "a profile failure must not propagate out of bootstrap and reject whenReady")

  assert.ok(calls.includes("registerIpc"), "IPC handlers must be registered even when profile sync fails")
  assert.ok(calls.includes("createWindow"), "the window must open even when profile sync fails")
  assert.ok(
    calls.indexOf("registerIpc") < calls.indexOf("ensureProfile"),
    "registerIpc must run before the throwing ensureProfile"
  )
  assert.ok(
    calls.indexOf("ensureProfile") < calls.indexOf("createWindow"),
    "the renderer must query a settled profile state"
  )
  assert.ok(
    calls.includes("onProfileError:profile boom"),
    "the profile error must be surfaced via onProfileError"
  )
  assert.equal(result, null, "bootstrap returns null when the profile can't be synced")
})

test("profile lifecycle transitions blocked to ready on retry and publishes the new state", () => {
  let attempts = 0
  const events = []
  const ready = []
  const lifecycle = new ProfileLifecycle({
    profileDir: "/profile",
    configPath: "/profile/opencode.json",
    ensureProfile: () => {
      attempts += 1
      if (attempts === 1) {
        const error = new Error("EACCES")
        error.stage = "directory"
        throw error
      }
      return { profileDir: "/profile", configPath: "/profile/opencode.json" }
    },
    onReady: (profile) => ready.push(profile),
    emit: (channel, payload) => events.push({ channel, payload })
  })

  assert.equal(lifecycle.initialize().status, "blocked")
  assert.throws(() => lifecycle.requireReady(), /EACCES/)

  const result = lifecycle.initialize({ publish: true })
  assert.equal(result.status, "ready")
  assert.equal(lifecycle.requireReady().configPath, "/profile/opencode.json")
  assert.equal(ready.length, 1)
  assert.deepEqual(events, [{ channel: "profile:update", payload: result }])
})

test("profile lifecycle exposes recovered backup metadata", () => {
  const lifecycle = new ProfileLifecycle({
    profileDir: "/profile",
    configPath: "/profile/opencode.json",
    ensureProfile: () => ({
      profileDir: "/profile",
      configPath: "/profile/opencode.json",
      recovery: { message: "reset", backupPath: "/profile/opencode.json.corrupt.bak" }
    })
  })

  assert.deepEqual(lifecycle.initialize(), {
    status: "recovered",
    profileDir: "/profile",
    configPath: "/profile/opencode.json",
    stage: null,
    message: "reset",
    backupPath: "/profile/opencode.json.corrupt.bak"
  })
})

test("profile lifecycle remains blocked when retry fails again", () => {
  let blockedCalls = 0
  const lifecycle = new ProfileLifecycle({
    profileDir: "/profile",
    configPath: "/profile/opencode.json",
    ensureProfile: () => {
      const error = new Error("disk full")
      error.stage = "config"
      throw error
    },
    onBlocked: () => { blockedCalls += 1 }
  })

  assert.equal(lifecycle.initialize().status, "blocked")
  assert.equal(lifecycle.initialize({ publish: true }).status, "blocked")
  assert.equal(blockedCalls, 2)
  assert.throws(() => lifecycle.requireReady(), /disk full/)
})
