const { execFileSync } = require("node:child_process")
const { windowsAwareCommand } = require("./windows-command")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const tar = require("tar")

// electron-builder `beforePack` hook. Runs once per architecture being packed.
//
// Problem it solves: the opencode runtime ships as platform/arch-specific binaries via
// `@opencode-ai/cli`'s optionalDependencies. `npm install` only fetches the package matching the
// *build machine's* platform/arch, so cross-arch packages must be fetched before
// electron-builder walks node_modules.
//
// This hook, for the arch currently being packed:
//   1. ensures node_modules/@opencode-ai/cli-<platform>-<arch> exists (installing it on demand
//      when the build host is a different arch), and
//   2. relocates the *other* arch's @opencode-ai/cli-<platform>-* packages out of node_modules
//      so only the correct binary is bundled (asarUnpack globs `@opencode-ai/cli-*`). The
//      relocation is restored on process exit so a multi-arch build leaves node_modules as it
//      found it.

// Arch enum from builder-util: ia32=0, x64=1, armv7l=2, arm64=3, universal=4.
const ARCH_NAMES = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64", 4: "universal" }

const root = path.join(__dirname, "..")
const nodeModules = path.join(root, "node_modules")

// v2 ships as a DIFFERENT npm package from v1: scoped `@opencode-ai/cli-<platform>-<arch>` with
// an `opencode2` binary, versioned independently of `opencode-ai`. It gets the same per-arch
// fetch + isolate treatment, just under the `@opencode-ai/` scope directory.
const V2_SCOPE = "@opencode-ai"

function opencodeV2Version() {
  const pkg = JSON.parse(fs.readFileSync(path.join(nodeModules, V2_SCOPE, "cli", "package.json"), "utf8"))
  return pkg.version
}

function packageExecutableV2(electronPlatformName) {
  return electronPlatformName === "win32" ? "opencode2.exe" : "opencode2"
}

function packageNameForV2(electronPlatformName, arch) {
  const platform = packagePlatform(electronPlatformName)
  if (!platform) return null
  return `${V2_SCOPE}/cli-${platform}-${arch}`
}

function packagePlatform(electronPlatformName) {
  if (electronPlatformName === "darwin") return "darwin"
  if (electronPlatformName === "win32") return "windows"
  return null
}

// Fetch opencode-<platform>-<arch>@<version> into node_modules when it is missing
// (build host arch differs from the arch being packed). The package declares
// `cpu`/`os`, so `npm install` aborts cross-arch with EBADPLATFORM (and `--cpu`/
// `--os` don't override the host CPU check). `npm pack` only downloads the
// tarball — no platform guard, no scripts — so we fetch + extract it manually.
function ensurePackage(pkgName, version, executableName) {
  const target = path.join(nodeModules, pkgName)
  if (fs.existsSync(path.join(target, "bin", executableName))) return target

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-pack-"))
  try {
    // Through cmd.exe /c on Windows: npm is npm.cmd there, which Node refuses to spawn directly
    // since the CVE-2024-27980 fix, and `temp` is an absolute path that can contain spaces — so
    // shell:true (unescaped argv, Node DEP0190) is not an option either.
    const tarball = execFileSync(
      ...windowsAwareCommand("npm", ["pack", `${pkgName}@${version}`, "--silent", "--pack-destination", temp]),
      { encoding: "utf8" }
    ).trim().split("\n").pop().trim()
    const tarballPath = path.join(temp, tarball)
    if (!fs.existsSync(tarballPath)) throw new Error(`npm pack did not produce ${pkgName}@${version} tarball`)

    // npm tarballs extract their contents under a top-level "package/" directory.
    const extractDir = path.join(temp, "extracted")
    fs.mkdirSync(extractDir, { recursive: true })
    tar.x({ file: tarballPath, cwd: extractDir, sync: true })
    const extracted = path.join(extractDir, "package")
    if (!fs.existsSync(path.join(extracted, "bin", executableName))) {
      throw new Error(`Extracted ${pkgName} is missing bin/${executableName}`)
    }

    fs.rmSync(target, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.renameSync(extracted, target)
    if (process.platform !== "win32") fs.chmodSync(path.join(target, "bin", executableName), 0o755)
    return target
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}

// Packages relocated out of node_modules by the current process, keyed by their
// original path. Restored before each subsequent pack and on process exit so a
// multi-arch build (which calls beforePack once per arch in one process) leaves
// node_modules intact and lets a later arch reuse a stashed package.
const stashed = new Map()

function restoreStashed() {
  for (const [from, to] of stashed) {
    if (fs.existsSync(to) && !fs.existsSync(from)) fs.renameSync(to, from)
    if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true })
    // The stash dir now lives inside the repo, so remove its temp parent too rather than leaving
    // .opencode-stash-* behind for the packager to pick up.
    fs.rmSync(path.dirname(to), { recursive: true, force: true })
  }
  stashed.clear()
}

let restoreHookRegistered = false

// Move every opencode-<platform>-* package that does NOT match `keepName` out of
// node_modules for the duration of this pack so only the correct binary is
// bundled (asarUnpack globs `opencode-*`).
function stashDirectory(from, name) {
  if (stashed.has(from)) return
  // Stash NEXT TO node_modules, not in os.tmpdir(): on Windows CI the workspace is on D: while the
  // temp dir is on C:, and fs.renameSync cannot move a directory across devices (EXDEV).
  const to = fs.mkdtempSync(path.join(root, ".opencode-stash-")) + path.sep + name
  fs.renameSync(from, to)
  stashed.set(from, to)
}

// Same isolation for the scoped v2 packages, which live one level deeper under `@opencode-ai/`.
// `keepName` is the bare directory name (e.g. "cli-darwin-arm64"), not the scoped specifier.
function isolateArchV2(platform, keepName) {
  if (!restoreHookRegistered) {
    process.once("exit", restoreStashed)
    restoreHookRegistered = true
  }
  const scopeDir = path.join(nodeModules, V2_SCOPE)
  if (!fs.existsSync(scopeDir)) return
  for (const entry of fs.readdirSync(scopeDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (!entry.name.startsWith(`cli-${platform}-`)) continue
    if (entry.name === keepName) continue
    stashDirectory(path.join(scopeDir, entry.name), entry.name)
  }
}

module.exports = async function beforePack(context) {
  const platform = packagePlatform(context.electronPlatformName)
  if (!platform) return

  // Undo isolation from a prior arch in this same multi-arch build so the
  // package this arch needs is back in node_modules before we look for it.
  restoreStashed()

  const arch = ARCH_NAMES[context.arch]
  if (arch !== "x64" && arch !== "arm64") {
    throw new Error(`Unsupported pack arch ${context.arch} (${arch}); expected x64 or arm64.`)
  }

  const pkgName = packageNameForV2(context.electronPlatformName, arch)
  const executableName = packageExecutableV2(context.electronPlatformName)
  const version = opencodeV2Version()

  ensurePackage(pkgName, version, executableName)
  isolateArchV2(platform, `cli-${platform}-${arch}`)

  console.log(`before-pack: bundling ${pkgName}@${version} for ${context.electronPlatformName}-${arch}`)
}

module.exports.ARCH_NAMES = ARCH_NAMES
module.exports.packageExecutableV2 = packageExecutableV2
module.exports.packageNameForV2 = packageNameForV2
module.exports.packagePlatform = packagePlatform
