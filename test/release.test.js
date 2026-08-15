const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { findAppBundle, validateReleaseEnvironment } = require("../scripts/release")

const ISSUER = "69a6de7e-1234-47e3-e053-5b8c7c11a4d1"
const notarizeEnv = {
  APPLE_API_KEY: "AuthKey.p8",
  APPLE_API_KEY_ID: "key-id",
  APPLE_API_ISSUER: ISSUER
}
const noIdentity = () => false
const hasIdentity = () => true

test("release preflight requires notarization credentials", () => {
  assert.throws(() => validateReleaseEnvironment({}, hasIdentity), /APPLE_API_KEY/)
  assert.throws(
    () => validateReleaseEnvironment({ ...notarizeEnv, APPLE_API_ISSUER: undefined }, hasIdentity),
    /APPLE_API_ISSUER/
  )
})

test("release preflight rejects an issuer id that is not a UUID", () => {
  // A cert SHA-1 fingerprint is an easy thing to paste here by mistake, and
  // notarytool only rejects it after the whole build has run.
  assert.throws(
    () =>
      validateReleaseEnvironment(
        { ...notarizeEnv, APPLE_API_ISSUER: "67F0611E79883696F3A889C9C4588A6B8EC0A59A" },
        hasIdentity
      ),
    /issuer UUID/
  )
})

test("release preflight accepts a keychain identity without a .p12", () => {
  assert.doesNotThrow(() => validateReleaseEnvironment(notarizeEnv, hasIdentity))
  assert.throws(() => validateReleaseEnvironment(notarizeEnv, noIdentity), /CSC_LINK is not set/)
})

test("release preflight accepts a .p12 without a keychain identity", () => {
  assert.doesNotThrow(() =>
    validateReleaseEnvironment(
      { ...notarizeEnv, CSC_LINK: "cert.p12", CSC_KEY_PASSWORD: "secret" },
      noIdentity
    )
  )
  assert.throws(
    () => validateReleaseEnvironment({ ...notarizeEnv, CSC_LINK: "cert.p12" }, noIdentity),
    /CSC_KEY_PASSWORD/
  )
})

test("release helper finds the packaged app bundle", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-release-"))
  const appPath = path.join(temp, "mac-arm64", "OpenWorking.app")
  fs.mkdirSync(appPath, { recursive: true })

  assert.equal(findAppBundle(temp, "OpenWorking"), appPath)
})
