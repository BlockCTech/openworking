const test = require("node:test")
const assert = require("node:assert/strict")

const { isSupportedNodeVersion } = require("../scripts/check-node")

test("Node guard accepts the minimum version and newer releases", () => {
  assert.equal(isSupportedNodeVersion("22.13.0"), true)
  assert.equal(isSupportedNodeVersion("22.13.1"), true)
  assert.equal(isSupportedNodeVersion("22.14.0"), true)
  assert.equal(isSupportedNodeVersion("24.0.0"), true)
})

test("Node guard rejects older and malformed versions", () => {
  assert.equal(isSupportedNodeVersion("22.12.9"), false)
  assert.equal(isSupportedNodeVersion("20.19.0"), false)
  assert.equal(isSupportedNodeVersion("22.13"), false)
  assert.equal(isSupportedNodeVersion("not-a-version"), false)
})
