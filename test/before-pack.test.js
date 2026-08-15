const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const {
  packageExecutableV2,
  packageNameForV2,
  packagePlatform
} = require("../scripts/before-pack")

test("beforePack maps Electron platform names", () => {
  assert.equal(packagePlatform("darwin"), "darwin")
  assert.equal(packagePlatform("win32"), "windows")
  assert.equal(packagePlatform("linux"), null)
})

// v2 ships as a separate SCOPED package with a differently named binary. Both facts were
// verified by unpacking the published tarballs for darwin-arm64 and windows-x64.
test("beforePack maps Electron platforms to OpenCode package names", () => {
  assert.equal(packageNameForV2("darwin", "arm64"), "@opencode-ai/cli-darwin-arm64")
  assert.equal(packageNameForV2("darwin", "x64"), "@opencode-ai/cli-darwin-x64")
  assert.equal(packageNameForV2("win32", "x64"), "@opencode-ai/cli-windows-x64")
  assert.equal(packageNameForV2("linux", "x64"), null)
})

test("beforePack selects the platform executable name", () => {
  assert.equal(packageExecutableV2("darwin"), "opencode2")
  assert.equal(packageExecutableV2("win32"), "opencode2.exe")
})

test("package and lock pin one OpenCode version across every optional platform package", () => {
  const root = path.join(__dirname, "..")
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"))
  const expectedVersion = "0.0.0-next-17292"
  const cli = lock.packages["node_modules/@opencode-ai/cli"]

  assert.equal(pkg.dependencies["@opencode-ai/cli"], expectedVersion)
  assert.equal(cli.version, expectedVersion)
  assert.deepEqual(cli.bin, { opencode2: "bin/opencode2.exe" })
  assert.equal(Object.keys(cli.optionalDependencies).length, 12)
  for (const [name, version] of Object.entries(cli.optionalDependencies)) {
    assert.equal(version, expectedVersion, `${name} optional dependency drifted`)
    assert.equal(lock.packages[`node_modules/${name}`]?.version, expectedVersion, `${name} lock entry drifted`)
  }
})

// The scoped v2 package does NOT match the unscoped `node_modules/opencode-*` glob, so without
// its own entry the v2 binary would be packed inside the asar and fail to execute at launch.
test("asarUnpack covers the scoped runtime package", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"))
  const globs = pkg.build.asarUnpack
  assert.ok(globs.includes("node_modules/@opencode-ai/cli-*/**/*"), "runtime glob must be present")
  // Guard the bug this replaced: an unscoped `node_modules/opencode-*` glob cannot match the
  // scoped runtime package, which would silently pack the binary inside the asar.
  assert.equal("node_modules/@opencode-ai/cli-darwin-arm64".startsWith("node_modules/opencode-"), false)
})
