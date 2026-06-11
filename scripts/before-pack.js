const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

// electron-builder `beforePack` hook. Runs once per architecture being packed.
//
// Problem it solves: the opencode runtime ships as platform/arch-specific
// binaries via `opencode-ai`'s optionalDependencies. `npm install` only fetches
// the package matching the *build machine's* arch, so an arm64 build host never
// gets `opencode-darwin-x64`. Packaging that build for x64 then bundles an arm64
// binary, and the app dies on Intel with `spawn Unknown system error -86`
// (EBADARCH). See scripts mirror logic in opencode-ai/postinstall.mjs.
//
// This hook, for the arch currently being packed:
//   1. ensures node_modules/opencode-<platform>-<arch> exists (installing it on
//      demand when the build host is a different arch),
//   2. overwrites the opencode-ai wrapper binary with that arch's binary, and
//   3. relocates the *other* arch's opencode-darwin-* packages out of
//      node_modules so only the correct binary is bundled (asarUnpack globs
//      `opencode-*`). The relocation is restored on process exit so a multi-arch
//      build leaves node_modules as it found it.

// Arch enum from builder-util: ia32=0, x64=1, armv7l=2, arm64=3, universal=4.
const ARCH_NAMES = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64", 4: "universal" }

const root = path.join(__dirname, "..")
const nodeModules = path.join(root, "node_modules")

function opencodeVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(nodeModules, "opencode-ai", "package.json"), "utf8"))
  return pkg.version
}

function copyBinary(source, target) {
  if (!fs.existsSync(source)) throw new Error(`opencode binary not found at ${source}`)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  if (fs.existsSync(target)) fs.unlinkSync(target)
  try {
    fs.linkSync(source, target)
  } catch {
    fs.copyFileSync(source, target)
  }
  fs.chmodSync(target, 0o755)
}

// Fetch opencode-darwin-<arch>@<version> into node_modules when it is missing
// (build host arch differs from the arch being packed). The package declares
// `cpu`/`os`, so `npm install` aborts cross-arch with EBADPLATFORM (and `--cpu`/
// `--os` don't override the host CPU check). `npm pack` only downloads the
// tarball — no platform guard, no scripts — so we fetch + extract it manually.
function ensurePackage(pkgName, version) {
  const target = path.join(nodeModules, pkgName)
  if (fs.existsSync(path.join(target, "bin", "opencode"))) return target

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-pack-"))
  try {
    const tarball = execFileSync("npm", ["pack", `${pkgName}@${version}`, "--silent", "--pack-destination", temp], {
      encoding: "utf8"
    }).trim().split("\n").pop().trim()
    const tarballPath = path.join(temp, tarball)
    if (!fs.existsSync(tarballPath)) throw new Error(`npm pack did not produce ${pkgName}@${version} tarball`)

    // npm tarballs extract their contents under a top-level "package/" directory.
    const extractDir = path.join(temp, "extracted")
    fs.mkdirSync(extractDir, { recursive: true })
    execFileSync("tar", ["-xf", tarballPath, "-C", extractDir], { stdio: "inherit" })
    const extracted = path.join(extractDir, "package")
    if (!fs.existsSync(path.join(extracted, "bin", "opencode"))) {
      throw new Error(`Extracted ${pkgName} is missing bin/opencode`)
    }

    fs.rmSync(target, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.renameSync(extracted, target)
    fs.chmodSync(path.join(target, "bin", "opencode"), 0o755)
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
  }
  stashed.clear()
}

let restoreHookRegistered = false

// Move every opencode-<platform>-* package that does NOT match `keepName` out of
// node_modules for the duration of this pack so only the correct binary is
// bundled (asarUnpack globs `opencode-*`).
function isolateArch(platform, keepName) {
  if (!restoreHookRegistered) {
    process.once("exit", restoreStashed)
    restoreHookRegistered = true
  }
  for (const entry of fs.readdirSync(nodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (!entry.name.startsWith(`opencode-${platform}-`)) continue
    if (entry.name === keepName) continue
    const from = path.join(nodeModules, entry.name)
    if (stashed.has(from)) continue
    const to = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-stash-")) + path.sep + entry.name
    fs.renameSync(from, to)
    stashed.set(from, to)
  }
}

module.exports = async function beforePack(context) {
  if (context.electronPlatformName !== "darwin") return

  // Undo isolation from a prior arch in this same multi-arch build so the
  // package this arch needs is back in node_modules before we look for it.
  restoreStashed()

  const arch = ARCH_NAMES[context.arch]
  if (arch !== "x64" && arch !== "arm64") {
    throw new Error(`Unsupported pack arch ${context.arch} (${arch}); expected x64 or arm64.`)
  }

  const pkgName = `opencode-darwin-${arch}`
  const version = opencodeVersion()

  const pkgDir = ensurePackage(pkgName, version)

  // The opencode-ai wrapper binary (bin/opencode.exe) is whatever arch ran
  // postinstall on this host; resolveRuntimeBin() can fall back to it, so point
  // it at the arch being packed.
  copyBinary(
    path.join(pkgDir, "bin", "opencode"),
    path.join(nodeModules, "opencode-ai", "bin", "opencode.exe")
  )

  isolateArch("darwin", pkgName)

  console.log(`before-pack: bundling ${pkgName}@${version} for darwin-${arch}`)
}
