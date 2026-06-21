const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { findAppBundle, validateReleaseEnvironment } = require("../scripts/release")

test("release preflight requires signing and notarization credentials", () => {
  assert.throws(() => validateReleaseEnvironment({}), /CSC_LINK/)
  assert.throws(() => validateReleaseEnvironment({
    CSC_LINK: "cert.p12",
    CSC_KEY_PASSWORD: "secret",
    APPLE_API_KEY: "AuthKey.p8",
    APPLE_API_KEY_ID: "key-id"
  }), /APPLE_API_ISSUER/)
  assert.doesNotThrow(() => validateReleaseEnvironment({
    CSC_LINK: "cert.p12",
    CSC_KEY_PASSWORD: "secret",
    APPLE_API_KEY: "AuthKey.p8",
    APPLE_API_KEY_ID: "key-id",
    APPLE_API_ISSUER: "issuer-id"
  }))
})

test("release helper finds the packaged app bundle", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-release-"))
  const appPath = path.join(temp, "mac-arm64", "OpenWorking.app")
  fs.mkdirSync(appPath, { recursive: true })

  assert.equal(findAppBundle(temp, "OpenWorking"), appPath)
})
