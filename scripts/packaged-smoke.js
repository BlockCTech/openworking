const { spawnSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")
const asar = require("@electron/asar")

const root = path.join(__dirname, "..")
const dist = path.join(root, "dist")
const productName = "OpenWorking"

// Which arch to build + verify. Defaults to the host arch; pass --arch=x64 to
// check a cross-arch bundle (e.g. verifying the Intel build from an arm64 host).
const archArg = process.argv.find((arg) => arg.startsWith("--arch="))
const targetArch = archArg ? archArg.slice("--arch=".length) : process.arch
if (targetArch !== "x64" && targetArch !== "arm64") {
  throw new Error(`Unsupported --arch=${targetArch}; expected x64 or arm64.`)
}
const isCrossArch = targetArch !== process.arch

function findAppExecutable(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name)
    if (entry.isDirectory() && entry.name === `${productName}.app`) {
      return path.join(child, "Contents", "MacOS", productName)
    }
    if (entry.isDirectory()) {
      const found = findAppExecutable(child)
      if (found) return found
    }
  }
  return null
}

// The smoke test only verifies the packaged bundle's structure, so it must not
// require an Apple "Developer ID Application" identity. Disable code signing +
// notarization here (mac.forceCodeSigning/notarize are `true` for production
// dist:mac builds), mirroring the overrides in the pack:mac npm script.
const build = spawnSync(
  path.join(root, "node_modules", ".bin", "electron-builder"),
  ["--mac", "dir", `--${targetArch}`, "-c.mac.forceCodeSigning=false", "-c.mac.notarize=false"],
  {
    cwd: root,
    stdio: "inherit"
  }
)
if (build.status !== 0) process.exit(build.status || 1)

// electron-builder writes the .app to dist/mac/ for a single-arch build and
// dist/mac-<arch>/ when building multiple arches at once.
function appExecutableIn(dirName) {
  const candidate = path.join(dist, dirName, `${productName}.app`, "Contents", "MacOS", productName)
  return fs.existsSync(candidate) ? candidate : null
}
const desktopBin =
  appExecutableIn(`mac-${targetArch}`) || appExecutableIn("mac") || findAppExecutable(dist)
if (!desktopBin) throw new Error(`Packaged ${productName}.app executable was not found.`)

const resources = path.join(desktopBin, "..", "..", "Resources")
const appAsar = path.join(resources, "app.asar")
const runtime = path.join(resources, "app.asar.unpacked", "node_modules", `opencode-${process.platform}-${targetArch}`, "bin", "opencode")
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
  "translate-document",
  "translate-office-document",
  "webapp-testing"
]
if (!fs.existsSync(runtime)) throw new Error(`Bundled opencode runtime was not found at ${runtime}`)
// Guard against the EBADARCH (-86) regression: the bundled binary must match the
// arch being packaged, not just exist. `file` reports the Mach-O CPU type.
const expectedMachOArch = targetArch === "arm64" ? "arm64" : "x86_64"
const machO = spawnSync("file", ["-b", runtime], { encoding: "utf8" })
if (machO.status !== 0) throw new Error(`Could not inspect bundled runtime arch: ${machO.stderr || machO.error}`)
if (!machO.stdout.includes(expectedMachOArch)) {
  throw new Error(`Bundled opencode runtime is ${machO.stdout.trim()} but expected ${expectedMachOArch} for ${targetArch}.`)
}
// Only the matching arch package may be bundled — a stray opencode-darwin-* of
// another arch would let resolveRuntimeBin fall through to the wrong binary.
const unpackedModules = path.join(resources, "app.asar.unpacked", "node_modules")
const strayArch = fs.readdirSync(unpackedModules)
  .filter((name) => name.startsWith(`opencode-${process.platform}-`) && name !== `opencode-${process.platform}-${targetArch}`)
if (strayArch.length) throw new Error(`Unexpected bundled opencode arch package(s): ${strayArch.join(", ")}`)
for (const skill of expectedSkills) {
  if (!fs.existsSync(path.join(skills, skill, "SKILL.md"))) throw new Error(`Expected bundled skill ${skill} at ${skills}`)
}
if (!fs.existsSync(path.join(skills, "pdf", "references", "host-tools.md"))) {
  throw new Error(`Expected nested PDF references at ${skills}`)
}
if (!fs.existsSync(path.join(resources, "opencode", "tools", "translate_document.js"))) {
  throw new Error("Expected bundled translate_document tool wrapper.")
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
    PATH: "/usr/bin:/bin"
  }
})
if (smoke.status !== 0) process.exit(smoke.status || 1)
console.log("packaged smoke passed")
