const test = require("node:test")
const assert = require("node:assert/strict")

const { filePermissionHint } = require("../src/error-hints")

test("permission-shaped failures get an actionable hint", () => {
  for (const message of [
    "EACCES: permission denied, open '/tmp/proj/README.md'",
    "spawn opencode EPERM",
    "Error: Operation not permitted",
    "opening the project failed: permission denied"
  ]) {
    assert.match(filePermissionHint(message), /System Settings › Privacy & Security › Files and Folders/, `no hint for: ${message}`)
  }
})

test("unrelated failures get no hint", () => {
  assert.equal(filePermissionHint("Could not find oldString in the file."), "")
  assert.equal(filePermissionHint(""), "")
  assert.equal(filePermissionHint(undefined), "")
})

// The runtime log path concatenates this into a larger string and owns the separator, so the
// shared text must not smuggle in its own leading newline.
test("the shared hint carries no leading newline", () => {
  const hint = filePermissionHint("EACCES: permission denied")
  assert.ok(!hint.startsWith("\n"))
  assert.equal(hint, hint.trim())
})
