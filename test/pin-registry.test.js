const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { PinRegistry } = require("../src/pin-registry")

test("pin registry returns an empty list before anything is pinned", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-pins-"))
  const registry = new PinRegistry(path.join(temp, "app-data"))

  assert.deepEqual(registry.list(), [])
})

test("pin registry persists session metadata and removes pins", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-pins-"))
  const userData = path.join(temp, "app-data")
  const registry = new PinRegistry(userData)
  const meta = { projectId: "proj_1", title: "Fix PATH async", updatedAt: "2026-06-21T00:00:00.000Z" }

  assert.deepEqual(registry.set("ses_abc", true, meta), [{ sessionId: "ses_abc", ...meta }])
  // A fresh registry over the same userData sees the persisted pin + metadata.
  assert.deepEqual(new PinRegistry(userData).list(), [{ sessionId: "ses_abc", ...meta }])

  // The on-disk shape stores metadata keyed by session id.
  const raw = JSON.parse(fs.readFileSync(path.join(userData, "pinned-sessions.json"), "utf8"))
  assert.deepEqual(raw, { pins: { ses_abc: meta } })

  // Unpinning removes the id.
  assert.deepEqual(registry.set("ses_abc", false), [])
  assert.deepEqual(new PinRegistry(userData).list(), [])
})

test("pin registry tolerates the legacy boolean shape", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-pins-"))
  const userData = path.join(temp, "app-data")
  fs.mkdirSync(userData, { recursive: true })
  // An older build wrote `{ pins: { [id]: true } }`.
  fs.writeFileSync(path.join(userData, "pinned-sessions.json"), JSON.stringify({ pins: { ses_legacy: true } }))

  assert.deepEqual(new PinRegistry(userData).list(), [
    { sessionId: "ses_legacy", projectId: null, title: "", updatedAt: null }
  ])
})

test("pin registry rejects empty session ids", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-pins-"))
  const registry = new PinRegistry(path.join(temp, "app-data"))

  assert.throws(() => registry.set("   ", true), /Session id is required/)
})
