const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

// Bump the package version and build a macOS .dmg whose filename embeds the new
// version. Usage: node scripts/release.js [patch|minor|major]   (default: patch)
// Does NOT create a git commit/tag — commit the version bump yourself.

const root = path.join(__dirname, "..")
const allowed = ["patch", "minor", "major"]
// Notarization always needs an App Store Connect API key. The signing identity
// may come either from a .p12 (CSC_LINK/CSC_KEY_PASSWORD, e.g. on CI) or from a
// "Developer ID Application" identity already in the login keychain.
const requiredEnv = ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"]
const SIGNING_IDENTITY_PREFIX = "Developer ID Application"
const ISSUER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function npm(args) {
  execFileSync("npm", args, { cwd: root, stdio: "inherit" })
}

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: "inherit" })
}

function readVersion() {
  return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version
}

function hasKeychainSigningIdentity() {
  try {
    const output = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], {
      encoding: "utf8"
    })
    return output.includes(SIGNING_IDENTITY_PREFIX)
  } catch {
    return false
  }
}

function validateReleaseEnvironment(env = process.env, findIdentity = hasKeychainSigningIdentity) {
  const missing = requiredEnv.filter((name) => !env[name])
  if (missing.length) {
    throw new Error(`Missing macOS release signing environment variables: ${missing.join(", ")}`)
  }

  // Catch a bad issuer id here rather than after a ~20 minute build: notarytool
  // rejects it only at upload time.
  if (!ISSUER_UUID.test(env.APPLE_API_ISSUER)) {
    throw new Error(
      `APPLE_API_ISSUER must be the App Store Connect issuer UUID (got "${env.APPLE_API_ISSUER}").\n` +
        "Find it in App Store Connect → Users and Access → Integrations → App Store Connect API."
    )
  }

  if (env.CSC_LINK) {
    if (!env.CSC_KEY_PASSWORD) {
      throw new Error("CSC_LINK is set but CSC_KEY_PASSWORD is missing.")
    }
    return
  }

  if (!findIdentity()) {
    throw new Error(
      `No "${SIGNING_IDENTITY_PREFIX}" identity found in the keychain, and CSC_LINK is not set.\n` +
        "Either import the certificate (security find-identity -v -p codesigning to check)\n" +
        "or point CSC_LINK/CSC_KEY_PASSWORD at a .p12."
    )
  }
}

// notarytool only authenticates at upload time, which is the very end of a
// ~20 minute two-architecture build. Spend a few seconds proving the
// credentials up front instead.
function verifyNotarizationCredentials(env = process.env) {
  try {
    execFileSync(
      "xcrun",
      [
        "notarytool",
        "history",
        "--key",
        env.APPLE_API_KEY,
        "--key-id",
        env.APPLE_API_KEY_ID,
        "--issuer",
        env.APPLE_API_ISSUER
      ],
      { stdio: "pipe", encoding: "utf8" }
    )
  } catch (error) {
    const detail = `${error.stdout || ""}${error.stderr || ""}`.trim()
    throw new Error(
      "App Store Connect credentials were rejected by notarytool:\n" +
        `${detail || error.message}\n\n` +
        "Check that APPLE_API_ISSUER is the Issuer ID copied from App Store Connect →\n" +
        "Users and Access → Integrations → App Store Connect API (Team Keys), that the key\n" +
        `id (${env.APPLE_API_KEY_ID}) is still active there, and that APPLE_API_KEY points at\n` +
        "its matching .p8 file."
    )
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

  console.log("→ Checking App Store Connect credentials…")
  verifyNotarizationCredentials(env)

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
