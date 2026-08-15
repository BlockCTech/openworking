const { spawnSync } = require("node:child_process")
const { windowsAwareCommand } = require("./windows-command")
const fs = require("node:fs")
const path = require("node:path")
const asar = require("@electron/asar")

const root = path.join(__dirname, "..")
const dist = path.join(root, "dist")
const productName = "OpenWorking"

const platformArg = process.argv.find((arg) => arg.startsWith("--platform="))
const targetPlatform = platformArg ? platformArg.slice("--platform=".length) : process.platform
if (targetPlatform !== "darwin" && targetPlatform !== "win32") {
  throw new Error(`Unsupported --platform=${targetPlatform}; expected darwin or win32.`)
}
if (targetPlatform !== process.platform) {
  throw new Error(`Packaged smoke for ${targetPlatform} must run on that operating system (current: ${process.platform}).`)
}

// Which arch to build + verify. Defaults to the host arch; pass --arch=x64 to
// check a cross-arch bundle (e.g. verifying the Intel build from an arm64 host).
const archArg = process.argv.find((arg) => arg.startsWith("--arch="))
const targetArch = archArg ? archArg.slice("--arch=".length) : process.arch
if (targetArch !== "x64" && targetArch !== "arm64") {
  throw new Error(`Unsupported --arch=${targetArch}; expected x64 or arm64.`)
}
const isCrossArch = targetArch !== process.arch

function findDesktopExecutable(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name)
    if (targetPlatform === "darwin" && entry.isDirectory() && entry.name === `${productName}.app`) {
      return path.join(child, "Contents", "MacOS", productName)
    }
    if (targetPlatform === "win32" && entry.isFile() && entry.name === `${productName}.exe`) return child
    if (entry.isDirectory()) {
      const found = findDesktopExecutable(child)
      if (found) return found
    }
  }
  return null
}

const buildArgs = targetPlatform === "win32"
  ? ["--win", "dir", `--${targetArch}`]
  : ["--mac", "dir", `--${targetArch}`, "-c.mac.forceCodeSigning=false", "-c.mac.notarize=false"]

// Packaged smoke always creates an unsigned directory bundle. Production
// signing is isolated in the release workflows.
//
// On Windows the npm shim is electron-builder.cmd (the extension-less file there is a Unix shell
// script), and Node refuses to spawn a .cmd directly since the CVE-2024-27980 fix — which fails
// instantly, with no output at all. Go through cmd.exe /c rather than shell:true: the latter
// concatenates argv without escaping (Node DEP0190), so any argument containing a space would be
// re-split by the shell.
const build = spawnSync(
  ...windowsAwareCommand(
    path.join(root, "node_modules", ".bin", "electron-builder"),
    buildArgs
  ),
  {
    cwd: root,
    stdio: "inherit"
  }
)
if (build.status !== 0) process.exit(build.status || 1)

function desktopExecutableIn(dirName) {
  const candidate = targetPlatform === "win32"
    ? path.join(dist, dirName, `${productName}.exe`)
    : path.join(dist, dirName, `${productName}.app`, "Contents", "MacOS", productName)
  return fs.existsSync(candidate) ? candidate : null
}

const outputPrefix = targetPlatform === "win32" ? "win" : "mac"
const desktopBin =
  desktopExecutableIn(`${outputPrefix}-${targetArch}-unpacked`) ||
  desktopExecutableIn(`${outputPrefix}-unpacked`) ||
  desktopExecutableIn(`${outputPrefix}-${targetArch}`) ||
  desktopExecutableIn(outputPrefix) ||
  findDesktopExecutable(dist)
if (!desktopBin) throw new Error(`Packaged ${productName} executable was not found.`)

const resources = targetPlatform === "win32"
  ? path.join(path.dirname(desktopBin), "resources")
  : path.join(desktopBin, "..", "..", "Resources")
const appAsar = path.join(resources, "app.asar")
const runtimePlatform = targetPlatform === "win32" ? "windows" : "darwin"
// The runtime ships as the scoped package @opencode-ai/cli-<platform>-<arch> with an
// `opencode2` binary, unpacked out of the asar so it can be executed.
const runtimeExecutable = targetPlatform === "win32" ? "opencode2.exe" : "opencode2"
const runtime = path.join(resources, "app.asar.unpacked", "node_modules", "@opencode-ai", `cli-${runtimePlatform}-${targetArch}`, "bin", runtimeExecutable)
const skills = path.join(resources, "opencode", "skills")
const expectedSkills = [
  "explain-project",
  "find-bugs",
  "write-tests",
  "summarize-changes",
  "code-review",
  "docs-update",
  "pdf",
  "pptx",
  "skill-creator",
  "xlsx",
  "docx",
  "webapp-testing",
  "cross-chat-memory",
  "browser-use",
  "backlog"
]
if (!fs.existsSync(runtime)) throw new Error(`Bundled opencode runtime was not found at ${runtime}`)

function peArchitecture(executable) {
  const bytes = fs.readFileSync(executable)
  if (bytes.length < 64 || bytes.toString("ascii", 0, 2) !== "MZ") throw new Error(`${executable} is not a PE executable.`)
  const peOffset = bytes.readUInt32LE(0x3c)
  if (bytes.toString("ascii", peOffset, peOffset + 4) !== "PE\u0000\u0000") throw new Error(`${executable} has no PE header.`)
  const machine = bytes.readUInt16LE(peOffset + 4)
  if (machine === 0x8664) return "x64"
  if (machine === 0xaa64) return "arm64"
  return `unknown-0x${machine.toString(16)}`
}

if (targetPlatform === "win32") {
  for (const executable of [desktopBin, runtime]) {
    const actualArch = peArchitecture(executable)
    if (actualArch !== targetArch) {
      throw new Error(`${executable} is ${actualArch} but expected ${targetArch}.`)
    }
  }
} else {
  // Guard against the EBADARCH (-86) regression: the bundled binary must match
  // the arch being packaged, not just exist. `file` reports the Mach-O CPU type.
  const expectedMachOArch = targetArch === "arm64" ? "arm64" : "x86_64"
  const machO = spawnSync("file", ["-b", runtime], { encoding: "utf8" })
  if (machO.status !== 0) throw new Error(`Could not inspect bundled runtime arch: ${machO.stderr || machO.error}`)
  if (!machO.stdout.includes(expectedMachOArch)) {
    throw new Error(`Bundled opencode runtime is ${machO.stdout.trim()} but expected ${expectedMachOArch} for ${targetArch}.`)
  }
}
// Only the matching arch package may be bundled — a stray cli-<platform>-* for another arch
// would let resolveRuntimeBin fall through to the wrong binary.
const unpackedModules = path.join(resources, "app.asar.unpacked", "node_modules")
const scopeDir = path.join(unpackedModules, "@opencode-ai")
const strayArch = fs.existsSync(scopeDir)
  ? fs.readdirSync(scopeDir).filter((name) => name.startsWith(`cli-${runtimePlatform}-`) && name !== `cli-${runtimePlatform}-${targetArch}`)
  : []
if (strayArch.length) throw new Error(`Unexpected bundled opencode arch package(s): ${strayArch.join(", ")}`)
for (const skill of expectedSkills) {
  if (!fs.existsSync(path.join(skills, skill, "SKILL.md"))) throw new Error(`Expected bundled skill ${skill} at ${skills}`)
}
if (!fs.existsSync(path.join(skills, "pdf", "references", "host-tools.md"))) {
  throw new Error(`Expected nested PDF references at ${skills}`)
}
for (const plugin of ["translate_document.mjs", "translate_office_document.mjs", "remember.mjs"]) {
  if (!fs.existsSync(path.join(resources, "opencode", "plugins", plugin))) {
    throw new Error(`Expected bundled managed plugin ${plugin}.`)
  }
}
for (const retiredTool of ["translate_document.js", "remember.js"]) {
  if (fs.existsSync(path.join(resources, "opencode", "tools", retiredTool))) {
    throw new Error(`Unexpected legacy tool wrapper ${retiredTool}.`)
  }
}
for (const retiredSkill of ["translate-document", "translate-office-document"]) {
  if (fs.existsSync(path.join(skills, retiredSkill))) throw new Error(`Unexpected retired skill ${retiredSkill}.`)
}
for (const filename of ["opencode-config.schema.json", "models-dev-model.schema.json"]) {
  if (!fs.existsSync(path.join(resources, "opencode", "schemas", filename))) {
    throw new Error(`Expected bundled OpenCode schema snapshot ${filename}.`)
  }
}
const packagedConfigSource = asar.extractFile(appAsar, "src/opencode-config.js").toString("utf8")
const defaultApiKey = packagedConfigSource.match(/apiKey:\s*"([^"]*)"/)?.[1]
if (defaultApiKey !== "") throw new Error("Expected packaged default OpenCode API key to be empty.")
for (const filename of ["runtime.cjs", "schema.cjs", "pdfium.wasm", path.join("assets", "NotoSans-Regular.ttf")]) {
  if (!fs.existsSync(path.join(resources, "opencode", "document-tools", filename))) {
    throw new Error(`Expected bundled document tool asset ${filename}.`)
  }
}

// A cross-arch bundle (e.g. x64 built on arm64) cannot be launched natively, so
// we can only verify its structure + binary arch above, not run it.
if (isCrossArch) {
  console.log(`packaged smoke: skipped runtime launch (cross-arch ${targetArch} on ${process.arch}); verified bundle + binary arch only`)
  process.exit(0)
}

const smoke = spawnSync(process.execPath, [path.join(__dirname, "electron-smoke.js")], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    OPENWORKING_DESKTOP_BIN: desktopBin,
    PATH: targetPlatform === "win32"
      ? [path.join(process.env.SystemRoot || "C:\\Windows", "System32"), process.env.SystemRoot || "C:\\Windows"].join(path.delimiter)
      : "/usr/bin:/bin"
  }
})
if (smoke.status !== 0) process.exit(smoke.status || 1)
console.log("packaged smoke passed")
