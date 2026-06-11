const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

// Bump the package version and build a macOS .dmg whose filename embeds the new
// version. Usage: node scripts/release.js [patch|minor|major]   (default: patch)
// Does NOT create a git commit/tag — commit the version bump yourself.

const root = path.join(__dirname, "..")
const level = process.argv[2] || "patch"
const allowed = ["patch", "minor", "major"]
if (!allowed.includes(level)) {
  console.error(`Unknown bump level "${level}". Use one of: ${allowed.join(", ")}`)
  process.exit(1)
}

function npm(args) {
  execFileSync("npm", args, { cwd: root, stdio: "inherit" })
}

function readVersion() {
  return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version
}

console.log(`\n→ Bumping version (${level})…`)
npm(["version", level, "--no-git-tag-version"])
const version = readVersion()
console.log(`→ New version: ${version}`)

console.log("→ Building macOS .dmg…")
npm(["run", "dist:mac"])

const productName = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).build.productName
const distDir = path.join(root, "dist")
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
console.log("\nNext: commit the version bump, tag the release, and attach the .dmg")
console.log("to a GitHub release.")
