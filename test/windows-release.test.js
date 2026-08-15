const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const {
  artifactNames,
  parseOptions,
  signedBuildArgs,
  validateWindowsReleaseEnvironment,
  writeChecksum
} = require("../scripts/windows-release")

const signingEnv = {
  AZURE_TENANT_ID: "tenant",
  AZURE_CLIENT_ID: "client",
  AZURE_CLIENT_SECRET: "secret",
  AZURE_TRUSTED_SIGNING_ENDPOINT: "https://example.codesigning.azure.net/",
  AZURE_TRUSTED_SIGNING_ACCOUNT: "account",
  AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE: "profile",
  WINDOWS_PUBLISHER_NAME: "OpenWorking"
}

test("Windows release preflight requires Windows and every Azure signing field", () => {
  assert.throws(() => validateWindowsReleaseEnvironment(signingEnv, "darwin"), /must be built on Windows/)
  assert.throws(
    () => validateWindowsReleaseEnvironment({ ...signingEnv, AZURE_CLIENT_SECRET: "" }, "win32"),
    /AZURE_CLIENT_SECRET/
  )
  assert.doesNotThrow(() => validateWindowsReleaseEnvironment(signingEnv, "win32"))
})

test("Windows release options bump once and select an optional architecture", () => {
  assert.deepEqual(parseOptions([]), { bump: "patch", arch: null, shouldBump: true })
  assert.deepEqual(parseOptions(["minor", "--arch=arm64"]), { bump: "minor", arch: "arm64", shouldBump: true })
  assert.deepEqual(parseOptions(["--no-bump", "--arch=x64"]), { bump: "patch", arch: "x64", shouldBump: false })
  assert.throws(() => parseOptions(["--arch=ia32"]), /Unsupported Windows release arch/)
})

test("signed build args carry Azure config without exposing the client secret", () => {
  const args = signedBuildArgs(signingEnv, "x64")
  assert.ok(args.includes("--x64"))
  assert.ok(args.includes("-c.win.forceCodeSigning=true"))
  assert.ok(args.includes("-c.win.azureSignOptions.publisherName=OpenWorking"))
  assert.ok(args.includes("-c.extraMetadata.windowsPublisherName=OpenWorking"))
  assert.equal(args.some((arg) => arg.startsWith("-c.win.publisherName=")), false)
  assert.equal(args.some((arg) => arg.includes(signingEnv.AZURE_CLIENT_SECRET)), false)
})

test("Windows artifact names are stable and architecture-specific", () => {
  assert.deepEqual(artifactNames("1.2.3"), [
    "OpenWorking-1.2.3-x64.exe",
    "OpenWorking-1.2.3-arm64.exe"
  ])
  assert.deepEqual(artifactNames("1.2.3", "arm64"), ["OpenWorking-1.2.3-arm64.exe"])
})

test("checksum writer emits a conventional SHA-256 sidecar", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "windows-checksum-"))
  const installer = path.join(dir, "OpenWorking-1.2.3-x64.exe")
  fs.writeFileSync(installer, "installer")
  const checksum = writeChecksum(installer)
  assert.match(fs.readFileSync(checksum, "utf8"), /^[a-f0-9]{64} \*OpenWorking-1\.2\.3-x64\.exe\n$/)
})
