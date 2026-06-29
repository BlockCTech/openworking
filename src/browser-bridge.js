"use strict"

const crypto = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

// App bridge for the browser-use feature (Task 5). Pure Node + injectable deps so it unit tests without
// Electron. It (1) installs the Chrome NativeMessagingHosts manifest that lets the bundled extension talk
// to our native host, (2) writes a per-launch loopback token both the host and MCP read, and (3) reports
// install status. The native host is locked to one extension id; the loopback is 127.0.0.1 + token.

// Native host name used by both the extension (connectNative) and the manifest filename.
const NATIVE_HOST_NAME = "ai.inworking.openworking.browser_host"
// The deterministic id of the bundled unpacked extension, derived from its pinned manifest "key".
// Keep in sync with resources/browser-extension/manifest.json (asserted by browser-extension.test.js).
const BROWSER_EXTENSION_ID = "mmeiagmcgomgfihghkgphjddilameooa"

// macOS-only for v1. Chrome stable reads per-user native-messaging manifests from this directory.
function chromeNativeMessagingDir(home = os.homedir()) {
  return path.join(home, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts")
}

function hostManifestPath(home = os.homedir()) {
  return path.join(chromeNativeMessagingDir(home), `${NATIVE_HOST_NAME}.json`)
}

// Default place Chrome stable installs on macOS; presence is a best-effort signal for the UX.
function detectChrome(existsSync = fs.existsSync) {
  const appPath = "/Applications/Google Chrome.app"
  return { installed: existsSync(appPath), appPath: existsSync(appPath) ? appPath : null }
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex")
}

// The launcher Chrome executes. Chrome requires the manifest "path" to point at an executable; our host
// is a Node script, and packaged builds have no guaranteed system node — so we exec the Electron binary
// in ELECTRON_RUN_AS_NODE mode (always present in the .app) against the bundled host script. The shared
// host dir (token/port sidecars) is baked into the shim so the host and MCP rendezvous.
function buildLauncherScript({ execPath, hostScript, hostDir }) {
  const q = (value) => `'${String(value).replace(/'/g, "'\\''")}'`
  return [
    "#!/bin/sh",
    `export ELECTRON_RUN_AS_NODE=1`,
    `export OPENWORKING_BROWSER_HOST_DIR=${q(hostDir)}`,
    `exec ${q(execPath)} ${q(hostScript)}`,
    ""
  ].join("\n")
}

function hostManifestContents(launcherPath) {
  return {
    name: NATIVE_HOST_NAME,
    description: "TechTusCoWork browser bridge native host",
    path: launcherPath,
    type: "stdio",
    // Lock the host to exactly the bundled extension — Chrome refuses connections from any other origin.
    allowed_origins: [`chrome-extension://${BROWSER_EXTENSION_ID}/`]
  }
}

// Install (idempotently) everything Chrome needs to launch our host:
//   - <hostDir>/host.token   (per-launch loopback secret, 0600)
//   - <hostDir>/run-host.sh  (executable launcher shim, 0700)
//   - <ChromeNativeMessagingHosts>/<name>.json  (manifest pinned to the extension id)
// `deps`: { execPath, hostScript } locate the Electron binary and bundled host entry. Returns status.
function installHost({ home = os.homedir(), hostDir, execPath, hostScript } = {}) {
  if (!hostDir) throw new Error("installHost requires hostDir")
  if (!execPath) throw new Error("installHost requires execPath")
  if (!hostScript) throw new Error("installHost requires hostScript")

  fs.mkdirSync(hostDir, { recursive: true })
  const token = generateToken()
  const tokenPath = path.join(hostDir, "host.token")
  fs.writeFileSync(tokenPath, token, { mode: 0o600 })
  // writeFileSync's mode only applies when the file is created; chmod explicitly so a pre-existing
  // token file with looser perms (e.g. 0644 from a prior install) is always tightened to 0600.
  fs.chmodSync(tokenPath, 0o600)
  // host.port is written by the host process at runtime; clear any stale value so status is honest.
  try { fs.rmSync(path.join(hostDir, "host.port"), { force: true }) } catch {}

  const launcherPath = path.join(hostDir, "run-host.sh")
  fs.writeFileSync(launcherPath, buildLauncherScript({ execPath, hostScript, hostDir }), { mode: 0o700 })

  const manifestDir = chromeNativeMessagingDir(home)
  fs.mkdirSync(manifestDir, { recursive: true })
  const manifestPath = hostManifestPath(home)
  fs.writeFileSync(manifestPath, `${JSON.stringify(hostManifestContents(launcherPath), null, 2)}\n`)

  return { installed: true, manifestPath, launcherPath, extensionId: BROWSER_EXTENSION_ID }
}

// Validate that the installed manifest still points at our launcher and pins our extension id, and that
// the launcher exists. Used for status reporting; never throws on a missing/invalid install.
function status({ home = os.homedir(), hostDir } = {}) {
  const chrome = detectChrome()
  const manifestPath = hostManifestPath(home)
  const result = {
    chromeInstalled: chrome.installed,
    extensionId: BROWSER_EXTENSION_ID,
    hostInstalled: false,
    manifestPath
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    const launcher = manifest.path
    const allowed = Array.isArray(manifest.allowed_origins) ? manifest.allowed_origins : []
    const pinsExtension = allowed.includes(`chrome-extension://${BROWSER_EXTENSION_ID}/`)
    const launcherExists = !!launcher && fs.existsSync(launcher)
    result.hostInstalled = manifest.name === NATIVE_HOST_NAME && pinsExtension && launcherExists
    if (hostDir) result.tokenInstalled = fs.existsSync(path.join(hostDir, "host.token"))
  } catch {
    // No manifest yet, or unreadable — hostInstalled stays false.
  }
  return result
}

module.exports = {
  NATIVE_HOST_NAME,
  BROWSER_EXTENSION_ID,
  chromeNativeMessagingDir,
  hostManifestPath,
  hostManifestContents,
  buildLauncherScript,
  detectChrome,
  generateToken,
  installHost,
  status
}
