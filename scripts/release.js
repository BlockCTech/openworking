const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

// Bump the package version and build a macOS .dmg whose filename embeds the new
// version. Usage: node scripts/release.js [patch|minor|major]   (default: patch)
// Does NOT create a git commit/tag — commit the version bump yourself.

const root = path.join(__dirname, "..")
const allowed = ["patch", "minor", "major"]
const requiredEnv = [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "APPLE_API_KEY",
  "APPLE_API_KEY_ID",
  "APPLE_API_ISSUER"
]

function npm(args) {
  execFileSync("npm", args, { cwd: root, stdio: "inherit" })
}

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: "inherit" })
}

function readVersion() {
  return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version
}

function validateReleaseEnvironment(env = process.env) {
  const missing = requiredEnv.filter((name) => !env[name])
  if (missing.length) {
    throw new Error(`Missing macOS release signing environment variables: ${missing.join(", ")}`)
  }
}

function findAppBundle(directory, productName) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name)
    if (entry.isDirectory() && entry.name === `${productName}.app`) return child
    if (entry.isDirectory()) {
      const found = findAppBundle(child, productName)
      if (found) return found
    }
  }
  return null
}

function verifyMacSignature(appBundlePath) {
  run("codesign", ["--verify", "--deep", "--strict", appBundlePath])
  run("codesign", ["-dv", appBundlePath])
  run("spctl", ["--assess", "--type", "execute", "--verbose=4", appBundlePath])
}

function main(argv = process.argv.slice(2), env = process.env) {
  const level = argv[0] || "patch"
  if (!allowed.includes(level)) {
    throw new Error(`Unknown bump level "${level}". Use one of: ${allowed.join(", ")}`)
  }

  validateReleaseEnvironment(env)

  console.log(`\n→ Bumping version (${level})…`)
  npm(["version", level, "--no-git-tag-version"])
  const version = readVersion()
  console.log(`→ New version: ${version}`)

  console.log("→ Building signed and notarized macOS .dmg…")
  npm(["run", "dist:mac"])

  const productName = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).build.productName
  const distDir = path.join(root, "dist")
  const appBundlePath = findAppBundle(distDir, productName)
  if (!appBundlePath) throw new Error(`Packaged ${productName}.app was not found under ${distDir}`)

  console.log("→ Verifying macOS code signature and Gatekeeper assessment…")
  verifyMacSignature(appBundlePath)

  const dmg = fs
    .readdirSync(distDir)
    .filter((file) => file.endsWith(".dmg") && file.includes(version))
    .map((file) => path.join("dist", file))

  console.log(`\n✓ Released ${productName} ${version}`)
  if (dmg.length) {
    dmg.forEach((file) => console.log(`  ${file}`))
  } else {
    console.log("  (no matching .dmg found in dist/ — check the build output above)")
  }
  console.log("\nNext: commit the version bump and attach the .dmg to a GitHub release.")
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}

module.exports = {
  findAppBundle,
  validateReleaseEnvironment
}
